import { useRef, useState } from "react";
import type { DragEvent, ChangeEvent } from "react";
import { parseKndXml, type AnyKndDocument } from "@crm/schemas";
import "./KndUploader.css";

// РЕШЕНИЕ: Worker URL через env — в dev указывает на локальный wrangler,
// в prod на задеплоенный worker. Без хардкода.
const WORKER_URL = import.meta.env.VITE_INGEST_WORKER_URL ?? "http://localhost:8787";

interface KndUploaderProps {
  onParsed?: (doc: AnyKndDocument) => void;
  onError?: (msg: string) => void;
}

type Status = "idle" | "parsed" | "uploading" | "done" | "error";

interface State {
  status: Status;
  doc: AnyKndDocument | null;
  rawXml: string;
  error: string | null;
}

const INITIAL: State = { status: "idle", doc: null, rawXml: "", error: null };

export function KndUploader({ onParsed, onError }: KndUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [state, setState] = useState<State>(INITIAL);

  function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".xml")) {
      reportError("Выберите XML-файл КНД");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const xml = reader.result as string;
      const result = parseKndXml(xml);
      if (!result.ok) {
        reportError(result.error);
        return;
      }
      setState({ status: "parsed", doc: result.value, rawXml: xml, error: null });
      onParsed?.(result.value);
    };
    reader.onerror = () => reportError("Не удалось прочитать файл");
    reader.readAsText(file, "utf-8");
  }

  function reportError(msg: string) {
    setState({ status: "error", doc: null, rawXml: "", error: msg });
    onError?.(msg);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Сбрасываем value — иначе повторный выбор того же файла не сработает
    e.target.value = "";
  }

  async function handleUpload() {
    if (!state.doc) return;
    setState(s => ({ ...s, status: "uploading", error: null }));
    try {
      const res = await fetch(`${WORKER_URL}/api/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xml: state.rawXml }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setState(s => ({ ...s, status: "error", error: json.error ?? "Ошибка загрузки" }));
        return;
      }
      setState(s => ({ ...s, status: "done" }));
    } catch {
      setState(s => ({ ...s, status: "error", error: "Нет связи с сервером" }));
    }
  }

  const { status, doc, error } = state;

  return (
    <div className="knd-uploader">
      {/* Drop zone */}
      <div
        className={"knd-dropzone" + (dragging ? " knd-dropzone--active" : "")}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === "Enter" && inputRef.current?.click()}
        aria-label="Зона загрузки XML"
      >
        <div className="knd-dropzone-icon">📄</div>
        <p className="knd-dropzone-title">Перетащите XML или нажмите для выбора</p>
        <p className="knd-dropzone-hint">Форматы ФНС: КНД 1151001, 1110018 и другие</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".xml"
        style={{ display: "none" }}
        onChange={handleChange}
      />

      {/* Result card */}
      {doc && (
        <div className="knd-card">
          <div className="knd-card-row">
            <span className="knd-card-label">КНД</span>
            <span>{doc.КНД}</span>
          </div>
          <div className="knd-card-row">
            <span className="knd-card-label">Дата</span>
            <span>{doc.ДатаДок}</span>
          </div>
          <div className="knd-card-row">
            <span className="knd-card-label">ИНН</span>
            <span>{doc.ИННЮЛ ?? doc.ИННФЛ}</span>
          </div>
          {"СумНал" in doc && (
            <div className="knd-card-row">
              <span className="knd-card-label">Налог</span>
              <span>{((doc as { СумНал: number }).СумНал / 100).toLocaleString("ru-RU")} ₽</span>
            </div>
          )}
          {"Сумма" in doc && (
            <div className="knd-card-row">
              <span className="knd-card-label">Сумма</span>
              <span>{((doc as { Сумма: number }).Сумма / 100).toLocaleString("ru-RU")} ₽</span>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {status === "error" && error && (
        <div className="knd-error">{error}</div>
      )}

      {/* Success */}
      {status === "done" && (
        <div className="knd-success">Документ загружен в систему</div>
      )}

      {/* Actions */}
      {(status === "parsed" || status === "uploading" || status === "done") && (
        <div className="knd-actions">
          {status !== "done" && (
            <button
              className="knd-submit-btn"
              disabled={status === "uploading"}
              onClick={() => void handleUpload()}
            >
              {status === "uploading" ? "Загружаем..." : "Загрузить в систему"}
            </button>
          )}
          <button
            className="knd-reset-btn"
            onClick={() => setState(INITIAL)}
          >
            Выбрать другой
          </button>
        </div>
      )}
    </div>
  );
}
