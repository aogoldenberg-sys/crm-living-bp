/**
 * UploadPlanButton — загрузка бизнес-плана с AI-анализом.
 *
 * Поддерживаемые форматы: PDF, DOCX, XLSX, TXT, MD, RTF.
 * Drag-and-drop + файловый пикер.
 *
 * Тип файла определяется по MIME (file.type), а не по имени —
 * кириллица в имени файла (n8n заменяет на _) не ломает ветвление.
 * Если браузер не заполняет MIME (напр. .md) — фоллбэк по расширению.
 *
 * Загрузка: POST multipart/form-data → ${VITE_INGEST_WORKER_URL}/intake
 * Auth: Firebase ID Token (Authorization: Bearer <token>)
 */

import { useRef, useState, useCallback, type DragEvent } from "react";
import { auth } from "../firebase";

// Принимаемые расширения (для <input accept> и drag-and-drop)
const ACCEPTED_EXT = ".pdf,.doc,.docx,.txt,.rtf,.md,.xlsx,.xls,.jpeg,.jpg,.png,.heic";

// MIME-типы → строковый ключ для ветвления на сервере
const EXT_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  md: "text/markdown",
  rtf: "text/rtf",
};

/**
 * MIME из расширения если известен (приоритет над file.type —
 * браузер может вернуть application/octet-stream для .md/.xlsx).
 */
function resolveMime(file: File): string {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  return EXT_TO_MIME[ext] ?? (file.type || "application/octet-stream").toLowerCase();
}

type Status = "idle" | "uploading" | "done" | "error";

interface UploadPlanButtonProps {
  onSuccess?: () => void;
}

export function UploadPlanButton({ onSuccess }: UploadPlanButtonProps = {}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const upload = useCallback(
    async (file: File) => {
      setFileName(file.name);
      setStatus("uploading");
      setMessage(null);

      try {
        const user = auth.currentUser;
        if (!user) throw new Error("Не авторизован — обновите страницу и войдите снова.");
        const idToken = await user.getIdToken();

        const mime = resolveMime(file);
        const form = new FormData();
        form.append("file", file, file.name);
        // Явно передаём MIME — защита от кириллических имён
        form.append("mimeType", mime);

        const workerUrl = import.meta.env.VITE_INGEST_WORKER_URL as string;
        const res = await fetch(`${workerUrl}/intake`, {
          method: "POST",
          headers: { Authorization: `Bearer ${idToken}` },
          body: form,
        });

        const data = (await res.json().catch(() => ({}))) as { error?: string; details?: unknown };
        if (!res.ok) {
          console.error("[upload-plan] server error:", res.status, data);
          throw new Error(data.error ?? `Сервер вернул ${res.status}`);
        }

        setStatus("done");
        setMessage("Анализ завершён — данные появятся на дашборде через несколько секунд.");
        if (onSuccess) setTimeout(onSuccess, 1500);
      } catch (e) {
        console.error("[upload-plan] upload failed:", e);
        setStatus("error");
        setMessage(e instanceof Error ? e.message : "Неизвестная ошибка загрузки");
      }
    },
    [],
  );

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void upload(file);
    e.target.value = ""; // сбросить чтобы повторный выбор того же файла срабатывал
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void upload(file);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    // Только если уходим за пределы контейнера
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragging(false);
    }
  }

  const isLoading = status === "uploading";

  return (
    <div
      className={`upload-plan-group${dragging ? " upload-plan-group--drag" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      role="region"
      aria-label="Загрузка бизнес-плана"
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXT}
        onChange={handleChange}
        style={{ display: "none" }}
        aria-label="Выберите файл бизнес-плана"
        disabled={isLoading}
      />

      <button
        type="button"
        className="upload-plan-btn"
        onClick={() => inputRef.current?.click()}
        disabled={isLoading}
      >
        {isLoading
          ? "Анализируется…"
          : fileName
          ? "Сменить файл"
          : "Загрузить план"}
      </button>

      {fileName && !isLoading && (
        <span className="upload-plan-filename" title={fileName}>
          {fileName}
        </span>
      )}

      <p className="upload-plan-hint">
        PDF, Word, Excel, текст — перетащите или выберите
      </p>

      {message && (
        <p
          className={`upload-plan-msg${status === "error" ? " upload-plan-msg--error" : " upload-plan-msg--ok"}`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
