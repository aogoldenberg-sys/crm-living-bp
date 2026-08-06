import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ComplianceCase } from "@crm/schemas";
import "./ComplianceFlow.css";

interface Props {
  caseData: ComplianceCase;
  onChange: (updated: ComplianceCase) => void;
  onNewCase?: () => void;
  onLogout?: () => void;
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

type GeneratedDoc = { fileName: string; title: string; content: string };

export function DoneView({ caseData, onChange, onNewCase, onLogout }: Props) {
  const enc = new TextEncoder();
  const navigate = useNavigate();
  const [letter, setLetter] = useState(caseData.response?.letterDraft ?? "");
  const documents: GeneratedDoc[] = (caseData as Record<string, unknown>).documents as GeneratedDoc[] ?? [];

  function updateLetter(draft: string) {
    setLetter(draft);
    if (caseData.response) {
      onChange({ ...caseData, response: { ...caseData.response, letterDraft: draft } });
    }
  }

  function goToChecklist() {
    onChange({ ...caseData, status: "checklist_review" });
  }

  function handlePrint() {
    const w = window.open("", "_blank", "width=800,height=600");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>Ответ на требование</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 14px; padding: 40px; }
        p { white-space: pre-wrap; margin-top: 20px; }
      </style></head><body>
      <p>${letter.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  function handleDownloadZip() {
    const files: Array<{ name: string; data: Uint8Array }> = [];

    // 1. Сопроводительное письмо
    files.push({ name: "01_pismo_otvet.txt", data: enc.encode(letter) });

    // 2. Сформированные документы
    for (let i = 0; i < documents.length; i++) {
      const d = documents[i];
      files.push({ name: `${String(i + 2).padStart(2, "0")}_${d.fileName}`, data: enc.encode(d.content) });
    }

    const zip = buildZip(files);
    const url = URL.createObjectURL(zip);
    const a = document.createElement("a");
    a.href = url;
    a.download = "paket_dokumentov.zip";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="compliance-done">
      <span className="compliance-done-icon">✅</span>
      <h2 className="compliance-done-title">Пакет готов</h2>
      <p className="compliance-done-sub">
        Сформировано документов: <strong>{documents.length + 1}</strong> (письмо + {documents.length} приложений).
        Отредактируйте при необходимости и передайте юристу.
      </p>

      <p className="compliance-letter-label" style={{ alignSelf: "flex-start", marginBottom: 4 }}>Сопроводительное письмо</p>
      <textarea
        className="compliance-letter"
        value={letter}
        onChange={e => updateLetter(e.target.value)}
        placeholder="Текст мотивированного ответа..."
        style={{ width: "100%", minHeight: 180 }}
      />

      {documents.length > 0 && (
        <div style={{ alignSelf: "stretch", margin: "12px 0" }}>
          <p style={{ fontWeight: 600, fontSize: 14, margin: "0 0 8px", color: "#3A2800" }}>Документы пакета:</p>
          {documents.map((d, i) => (
            <details key={i} style={{ margin: "4px 0", fontSize: 13, color: "#3A2800" }}>
              <summary style={{ cursor: "pointer" }}>📄 {d.title}</summary>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, padding: "8px 12px", background: "rgba(200,160,60,0.06)", borderRadius: 8, margin: "4px 0", maxHeight: 200, overflow: "auto" }}>{d.content}</pre>
            </details>
          ))}
        </div>
      )}

      <div className="compliance-disclaimer" style={{ alignSelf: "stretch" }}>
        ⚠️ Проект. Перед отправкой проверьте с юристом.
      </div>

      <div className="compliance-done-actions">
        <button type="button" className="compliance-done-btn" onClick={handleDownloadZip}>
          Скачать ZIP ({documents.length + 1} файлов)
        </button>
        <button type="button" className="compliance-done-btn compliance-done-btn--secondary" onClick={handlePrint}>
          Печать письма
        </button>
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 16, width: "100%", flexWrap: "wrap" }}>
        <button type="button" className="paywall-back" onClick={goToChecklist}>
          ← Назад к чек-листу
        </button>
        {onNewCase && (
          <button type="button" className="paywall-back" onClick={onNewCase}>
            + Новый кейс
          </button>
        )}
        <button type="button" className="paywall-back" style={{ marginLeft: "auto" }} onClick={() => navigate("/dashboard")}>
          Выйти
        </button>
        {onLogout && (
          <button type="button" className="paywall-back" onClick={onLogout}>
            Сменить пользователя
          </button>
        )}
      </div>
    </div>
  );
}
