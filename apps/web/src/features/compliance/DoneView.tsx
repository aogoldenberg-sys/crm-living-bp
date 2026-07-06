import type { ComplianceCase } from "@crm/schemas";
import "./ComplianceFlow.css";

interface Props {
  caseData: ComplianceCase;
}

// ── Minimal client-side ZIP builder (no dependencies, uncompressed) ──────────

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of data) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = ((crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(n: number): [number, number] {
  return [n & 0xff, (n >> 8) & 0xff];
}
function u32(n: number): [number, number, number, number] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
}

function buildZip(files: Array<{ name: string; data: Uint8Array }>): Blob {
  const enc = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const cdParts: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;

  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const sz = f.data.length;

    const local = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04,
      0x14, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      ...u32(crc), ...u32(sz), ...u32(sz),
      ...u16(name.length), 0x00, 0x00,
      ...name,
    ]);
    offsets.push(pos);
    localParts.push(local, f.data);
    pos += local.length + sz;

    cdParts.push(new Uint8Array([
      0x50, 0x4b, 0x01, 0x02,
      0x3f, 0x00, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      ...u32(crc), ...u32(sz), ...u32(sz),
      ...u16(name.length), 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      ...u32(offsets[offsets.length - 1]!),
      ...name,
    ]));
  }

  const cdSize = cdParts.reduce((s, a) => s + a.length, 0);
  const eocd = new Uint8Array([
    0x50, 0x4b, 0x05, 0x06,
    0x00, 0x00, 0x00, 0x00,
    ...u16(files.length), ...u16(files.length),
    ...u32(cdSize), ...u32(pos),
    0x00, 0x00,
  ]);

  // Собираем все части в единый буфер — обходим TS-конфликт ArrayBuffer / ArrayBufferLike
  const totalLen = [...localParts, ...cdParts, eocd].reduce((s, a) => s + a.length, 0);
  const buf = new Uint8Array(totalLen);
  let off = 0;
  for (const chunk of [...localParts, ...cdParts, eocd]) {
    buf.set(chunk, off);
    off += chunk.length;
  }
  return new Blob([buf.buffer as ArrayBuffer], { type: "application/zip" });
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function DoneView({ caseData }: Props) {
  const enc = new TextEncoder();
  const letter = caseData.response?.letterDraft ?? "";

  function handlePrint() {
    const w = window.open("", "_blank", "width=800,height=600");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>Письмо-ответ на требование</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 14px; padding: 40px; }
        h1 { font-size: 16px; }
        p { white-space: pre-wrap; margin-top: 20px; }
        .refs { font-size: 12px; color: #555; margin-top: 30px; }
      </style></head><body>
      <h1>Ответ на требование</h1>
      <p>${letter.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
      <div class="refs">Правовые основания: ${(caseData.response?.legalRefs ?? []).join(", ")}</div>
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  function handleDownloadZip() {
    const files: Array<{ name: string; data: Uint8Array }> = [];

    // 1. Сопроводительное письмо
    files.push({ name: "письмо.txt", data: enc.encode(letter) });

    // 2. Список документов
    const docList = caseData.checklist
      .map((e) => {
        const tag = e.availability === "restorable" ? "[ДУБЛИКАТ]" : "[ОРИГИНАЛ]";
        return `${tag} ${e.label}`;
      })
      .join("\n");
    files.push({ name: "список_документов.txt", data: enc.encode(docList) });

    // 3. Правовые ссылки
    const refs = (caseData.response?.legalRefs ?? []).join("\n");
    files.push({ name: "правовые_основания.txt", data: enc.encode(refs) });

    const zip = buildZip(files);
    const url = URL.createObjectURL(zip);
    const a = document.createElement("a");
    a.href = url;
    a.download = "пакет_документов.zip";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="compliance-done">
      <span className="compliance-done-icon">✅</span>
      <h2 className="compliance-done-title">Пакет готов</h2>
      <p className="compliance-done-sub">
        Документы сформированы. Проверьте письмо и передайте юристу перед отправкой.
      </p>

      <div className="compliance-done-actions">
        <button type="button" className="compliance-done-btn" onClick={handleDownloadZip}>
          📦 Скачать ZIP
        </button>
        <button type="button" className="compliance-done-btn compliance-done-btn--secondary" onClick={handlePrint}>
          🖨 Печать письма
        </button>
      </div>
    </div>
  );
}
