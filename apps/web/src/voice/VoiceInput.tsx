import { useEffect, useRef, useState } from "react";

export interface VoiceInputProps {
  businessId: string;
  onResult: (result: { transcription: string; fields: Record<string, unknown> }) => void;
}

type RecordState = "idle" | "recording" | "uploading" | "error";

const MAX_SECONDS = 60;
const INGEST_URL = import.meta.env.VITE_INGEST_WORKER_URL as string;

export function VoiceInput({ businessId, onResult }: VoiceInputProps) {
  const [state, setState] = useState<RecordState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Очищаем таймер при размонтировании
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearInterval(timerRef.current);
      recorderRef.current?.stop();
    };
  }, []);

  function startTimer() {
    setElapsed(0);
    timerRef.current = setInterval(() => {
      setElapsed((s) => {
        if (s + 1 >= MAX_SECONDS) {
          stopRecording();
          return MAX_SECONDS;
        }
        return s + 1;
      });
    }, 1000);
  }

  function stopTimer() {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function startRecording() {
    setErrorMsg(null);
    chunksRef.current = [];

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setErrorMsg("Нет доступа к микрофону");
      return;
    }

    // РЕШЕНИЕ: webm/opus — лучшая поддержка в Chrome/Firefox; mp4 — Safari.
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/mp4";

    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunksRef.current, { type: mimeType });
      void uploadAudio(blob);
    };

    recorder.start(250); // кусками по 250 мс — плавнее
    setState("recording");
    startTimer();
  }

  function stopRecording() {
    stopTimer();
    recorderRef.current?.stop();
    // state → uploading ставится внутри uploadAudio после сборки blob
  }

  async function uploadAudio(blob: Blob) {
    setState("uploading");
    setErrorMsg(null);

    try {
      const res = await fetch(`${INGEST_URL}/voice/upload`, {
        method: "POST",
        headers: {
          "Content-Type": blob.type,
          "x-business-id": businessId,
        },
        body: blob,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(errData.error ?? `Ошибка ${res.status}`);
      }

      const data = await res.json() as { transcription: string; fields: Record<string, unknown> };
      setState("idle");
      onResult(data);
    } catch (e) {
      setState("error");
      setErrorMsg(e instanceof Error ? e.message : "Ошибка загрузки");
    }
  }

  const isRecording = state === "recording";
  const isUploading = state === "uploading";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: 20 }}>
      {/* Кнопка */}
      <button
        type="button"
        onClick={() => { isRecording ? stopRecording() : void startRecording(); }}
        disabled={isUploading}
        aria-label={isRecording ? "Остановить запись" : "Начать запись"}
        style={{
          width: 72, height: 72, borderRadius: "50%", border: "none", cursor: isUploading ? "default" : "pointer",
          background: isRecording
            ? "linear-gradient(135deg,#C62828,#E53935)"
            : "linear-gradient(135deg,#C89A34,#E4C260)",
          color: "#fff", fontSize: 28, display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: isRecording ? "0 0 0 4px rgba(198,40,40,.25)" : "0 2px 10px rgba(200,154,52,.35)",
          transition: "all .2s",
        }}
      >
        {isUploading
          ? <span style={{ display: "inline-block", width: 24, height: 24, border: "3px solid rgba(255,255,255,.35)", borderTop: "3px solid #fff", borderRadius: "50%", animation: "vSpin 0.8s linear infinite" }} />
          : isRecording ? "■" : "🎤"}
      </button>

      {/* Лейбл */}
      <span style={{ fontSize: 14, fontWeight: 600, color: "#3A2E1E" }}>
        {isUploading
          ? "Обрабатываем…"
          : isRecording
            ? `Запись ${elapsed} с`
            : "Говорить"}
      </span>

      {/* Ошибка */}
      {state === "error" && errorMsg && (
        <span style={{ fontSize: 12, color: "#C62828", textAlign: "center", maxWidth: 240 }}>{errorMsg}</span>
      )}

      <style>{`
        @keyframes vSpin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
