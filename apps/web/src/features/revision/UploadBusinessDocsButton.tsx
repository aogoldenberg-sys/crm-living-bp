/**
 * UploadBusinessDocsButton — загрузка операционных документов бизнеса.
 *
 * Отличие от UploadPlanButton: множественная загрузка, выбор типа документа,
 * endpoint /revision-doc вместо /intake.
 */

import { useRef, useState, useCallback, type DragEvent } from "react";
import { auth } from "../../firebase";

const KIND_OPTIONS: { value: string; label: string }[] = [
  { value: "bank_statement",  label: "Банковская выписка" },
  { value: "cash_report",     label: "Кассовый отчёт" },
  { value: "fin_report",      label: "Финансовая отчётность" },
  { value: "staff_schedule",  label: "Штатное расписание" },
  { value: "doc_registry",    label: "Реестр договоров" },
  { value: "turnover_sheet",  label: "Оборотно-сальдовая ведомость" },
  { value: "fixed_asset_card", label: "Карточка ОС" },
  { value: "business_plan",   label: "Бизнес-план" },
  { value: "other",           label: "Другое" },
];

interface Props {
  defaultKind?: string;
  onSuccess?: () => void;
}

export function UploadBusinessDocsButton({ defaultKind, onSuccess }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState(defaultKind ?? "bank_statement");
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;

    setErrors([]);
    setToast(null);
    const workerUrl = import.meta.env.VITE_INGEST_WORKER_URL as string;
    const user = auth.currentUser;
    if (!user) { setErrors(["Не авторизован — обновите страницу."]); return; }

    const idToken = await user.getIdToken(true);
    const errs: string[] = [];

    for (let i = 0; i < list.length; i++) {
      setProgress(`Загружаем ${i + 1} из ${list.length}...`);
      const file = list[i]!;
      try {
        const form = new FormData();
        form.append("file", file, file.name);
        form.append("kind", kind);
        const res = await fetch(`${workerUrl}/revision-doc`, {
          method: "POST",
          headers: { Authorization: `Bearer ${idToken}` },
          body: form,
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          errs.push(`${file.name}: ${data.error ?? res.status}`);
        }
      } catch (e) {
        errs.push(`${file.name}: ${e instanceof Error ? e.message : "Ошибка загрузки"}`);
      }
    }

    setProgress(null);
    setErrors(errs);

    const ok = list.length - errs.length;
    if (ok > 0) {
      setToast(`${ok} документов принято`);
      if (onSuccess) setTimeout(onSuccess, 1500);
    }
  }, [kind, onSuccess]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) void uploadFiles(e.target.files);
    e.target.value = "";
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) void uploadFiles(e.dataTransfer.files);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) { e.preventDefault(); setDragging(true); }
  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
  }

  return (
    <div
      className={`ubd-wrap${dragging ? " ubd-wrap--drag" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="ubd-row">
        <select
          className="ubd-kind-select"
          value={kind}
          onChange={e => setKind(e.target.value)}
          disabled={!!progress}
        >
          {KIND_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          type="button"
          className="ubd-btn"
          onClick={() => inputRef.current?.click()}
          disabled={!!progress}
        >
          {progress ?? "Выбрать файлы"}
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={handleChange}
        disabled={!!progress}
      />

      <p className="ubd-hint">PDF, Word, Excel, текст — перетащите или выберите несколько</p>

      {toast && <p className="ubd-toast">{toast}</p>}
      {errors.map((err, i) => <p key={i} className="ubd-error">{err}</p>)}
    </div>
  );
}
