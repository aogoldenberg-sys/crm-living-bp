import { useState } from "react";
import { MATRIX_WORKER_URL } from "./config";

interface Props {
  phone: string;
  extension: string | null;  // внутренний номер менеджера из Matrix
  size?: number;
}

export function PhoneButton({ phone, extension, size = 14 }: Props) {
  const [calling, setCalling] = useState(false);
  const [result, setResult] = useState<"ok" | "err" | null>(null);

  async function call(e: React.MouseEvent) {
    e.stopPropagation();
    if (!extension) {
      // Fallback: простая tel: ссылка
      window.location.href = `tel:${phone}`;
      return;
    }
    setCalling(true);
    setResult(null);
    try {
      const r = await fetch(`${MATRIX_WORKER_URL}/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, user: extension }),
      });
      setResult(r.ok ? "ok" : "err");
    } catch {
      setResult("err");
    } finally {
      setCalling(false);
      setTimeout(() => setResult(null), 3000);
    }
  }

  const color = result === "ok" ? "#2E7D32" : result === "err" ? "#C62828" : "#1565C0";
  const label = calling ? "…" : result === "ok" ? "✓" : result === "err" ? "✗" : "📞";

  return (
    <button
      onClick={call}
      title={`Позвонить ${phone}`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        background: "none", border: `1px solid ${color}22`,
        color, borderRadius: 6, padding: "1px 6px",
        fontSize: size, cursor: "pointer", lineHeight: 1.6,
        transition: "all .15s",
      }}
    >
      {label} {phone}
    </button>
  );
}
