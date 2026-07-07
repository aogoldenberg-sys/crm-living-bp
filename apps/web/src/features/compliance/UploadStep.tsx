import { useRef, useState } from "react";
import type { ComplianceCase, RequestItem } from "@crm/schemas";
import { ExtractingProgress } from "./ExtractingProgress";
import { auth } from "../../firebase";
import { useAuth } from "../../auth/useAuth";
import "./ComplianceFlow.css";

interface Props {
  onComplete: (c: ComplianceCase) => void;
}

function buildCase(items: RequestItem[], businessId: string): ComplianceCase {
  const now = new Date().toISOString() as `${string}T${string}Z`;
  const checklist: ComplianceCase["checklist"] = items.flatMap((item) =>
    item.docKinds.map((docKind) => ({
      entryId: crypto.randomUUID(),
      requestItemId: item.itemId,
      docKind,
      label: [docKind, item.periodFrom, item.periodTo].filter(Boolean).join(" — "),
      availability: "missing_no_event" as const,
      fileRef: null,
      evidence: [],
      confirmedByOwner: false,
    })),
  );

  return {
    caseId: crypto.randomUUID(),
    businessId,
    authority: "fns_kameral",
    createdAt: now,
    sourceFileRef: "uploaded",
    items,
    checklist,
    drafts: [],
    response: {
      responseId: crypto.randomUUID(),
      authority: "fns_kameral",
      incomingRef: { number: null, date: null, fileRef: "uploaded" },
      letterDraft:
        "В ответ на Ваше требование сообщаем, что в рамках проверки прилагаем запрошенные документы.",
      legalRefs: ["ст. 93 НК РФ", "ст. 31 НК РФ"],
      providedEntryIds: [],
      missingExplained: [],
      deadline: null,
      status: "draft",
    },
    completeness: 0,
    status: "checklist_review",
  };
}

export function UploadStep({ onComplete }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [scanError, setScanError] = useState(false);
  const businessId = useAuth((s) => s.businessId) ?? "";

  async function handleFile(file: File) {
    setScanError(false);
    setProcessing(true);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Не авторизован");
      const idToken = await user.getIdToken();

      const mime =
        file.type ||
        (file.name.endsWith(".pdf") ? "application/pdf" : "image/jpeg");

      const form = new FormData();
      form.append("file", file, file.name);
      form.append("mimeType", mime);

      const workerUrl = import.meta.env.VITE_INGEST_WORKER_URL as string;
      const res = await fetch(`${workerUrl}/compliance/extract`, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
        body: form,
      });

      const data = (await res.json().catch(() => ({}))) as {
        items?: RequestItem[];
        code?: string;
        error?: string;
      };

      if (res.status === 422 || data.code === "INSUFFICIENT_DATA") {
        setScanError(true);
        return;
      }
      if (!res.ok) {
        console.error("[compliance/extract] error:", data.error);
        setScanError(true);
        return;
      }
      if (!data.items?.length) {
        setScanError(true);
        return;
      }

      onComplete(buildCase(data.items, businessId));
    } catch (e) {
      console.error("[compliance/extract] fetch failed:", e);
      setScanError(true);
    } finally {
      setProcessing(false);
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  if (processing) return <ExtractingProgress />;

  if (scanError) {
    return (
      <div className="compliance-upload">
        <div className="compliance-scan-error">
          <span className="compliance-scan-error-icon">⚠️</span>
          <p className="compliance-scan-error-title">Не удалось распознать требование.</p>
          <p className="compliance-scan-error-hint">
            Загрузите чёткий скан документа с текстом требования ФНС или другого контролирующего органа.
          </p>
          <button
            type="button"
            className="compliance-file-btn"
            onClick={() => { setScanError(false); inputRef.current?.click(); }}
          >
            Загрузить другой файл
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="compliance-upload">
      <div
        className={"compliance-dropzone" + (dragOver ? " compliance-dropzone--active" : "")}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <div className="compliance-dropzone-icon">🛡</div>
        <p className="compliance-dropzone-title">Загрузите требование</p>
        <p className="compliance-dropzone-hint">Перетащите файл сюда или нажмите для выбора</p>
        <p className="compliance-formats">PDF, JPEG, PNG, HEIC</p>
      </div>

      <button
        className="compliance-file-btn"
        onClick={() => inputRef.current?.click()}
        type="button"
      >
        Выбрать файл
      </button>

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.heic"
        style={{ display: "none" }}
        onChange={onInputChange}
      />
    </div>
  );
}
