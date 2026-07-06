import { useRef, useState } from "react";
import type { ComplianceCase } from "@crm/schemas";
import { ExtractingProgress } from "./ExtractingProgress";
import "./ComplianceFlow.css";

interface Props {
  onComplete: (c: ComplianceCase) => void;
}

function makeMockCase(): ComplianceCase {
  const now = new Date().toISOString() as `${string}T${string}Z`;
  const today = now.slice(0, 10) as `${number}-${number}-${number}`;

  const itemId = crypto.randomUUID();
  const entryId1 = crypto.randomUUID();
  const entryId2 = crypto.randomUUID();
  const entryId3 = crypto.randomUUID();

  return {
    caseId: crypto.randomUUID(),
    businessId: "demo",
    authority: "fns_kameral",
    createdAt: now,
    sourceFileRef: "uploaded-file",
    items: [
      {
        itemId,
        rawText: "Предоставить договоры и акты за период 01.01.2025 – 31.12.2025",
        docKinds: ["contract", "act"],
        periodFrom: "2025-01-01",
        periodTo: "2025-12-31",
        counterpartyInn: null,
        counterpartyName: null,
        extractConfidence: 0.94,
      },
    ],
    checklist: [
      {
        entryId: entryId1,
        requestItemId: itemId,
        docKind: "contract",
        label: "Договор №14 от 05.02.2025, ООО Ромашка",
        availability: "have_file",
        fileRef: "/docs/contract-14.pdf",
        evidence: [],
        confirmedByOwner: false,
      },
      {
        entryId: entryId2,
        requestItemId: itemId,
        docKind: "act",
        label: "Акт выполненных работ №14 от 03.05.2025, ООО Ромашка",
        availability: "restorable",
        fileRef: null,
        evidence: [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()],
        confirmedByOwner: false,
      },
      {
        entryId: entryId3,
        requestItemId: itemId,
        docKind: "invoice_facture",
        label: "УПД №14 от 03.05.2025",
        availability: "missing_no_event",
        fileRef: null,
        evidence: [],
        confirmedByOwner: false,
      },
    ],
    drafts: [],
    response: {
      responseId: crypto.randomUUID(),
      authority: "fns_kameral",
      incomingRef: {
        number: "12345",
        date: today,
        fileRef: "uploaded-file",
      },
      letterDraft:
        "В ответ на Ваше требование сообщаем, что в рамках камеральной налоговой проверки " +
        "прилагаем запрошенные документы. Оригиналы документов будут представлены по требованию.",
      legalRefs: ["ст. 93 НК РФ", "ст. 31 НК РФ"],
      providedEntryIds: [entryId1, entryId2],
      missingExplained: [
        { entryId: entryId3, reason: "Документ отсутствует, событие в учёте не зафиксировано" },
      ],
      deadline: today,
      status: "draft",
    },
    completeness: 0.67,
    status: "checklist_review",
  };
}

export function UploadStep({ onComplete }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file: File) {
    setProcessing(true);

    // HEIC → convert lazily, then proceed
    if (file.type === "image/heic" || file.name.toLowerCase().endsWith(".heic")) {
      try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore — heic2any has no bundled types; optional progressive enhancement
        const mod = await import(/* @vite-ignore */ "heic2any") as { default: (opts: { blob: Blob; toType: string }) => Promise<Blob | Blob[]> };
        await mod.default({ blob: file, toType: "image/jpeg" });
      } catch {
        // conversion failed — proceed anyway, server will handle it
      }
    }

    // Simulate extraction delay (800 ms)
    await new Promise<void>(res => setTimeout(res, 800));

    onComplete(makeMockCase());
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
