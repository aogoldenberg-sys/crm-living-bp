import { useState } from "react";
import type { FieldSpec } from "@crm/schemas";
import "./ComplianceFlow.css";

interface Props {
  fields: FieldSpec[];
  onSubmit: (answers: Record<string, string>) => void;
  onBack: () => void;
  assembling: boolean;
}

export function FieldsForm({ fields, onSubmit, onBack, assembling }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map(f => [f.key, ""])),
  );

  function set(key: string, val: string) {
    setValues(prev => ({ ...prev, [key]: val }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Send label→value so Claude gets human-readable keys ("ФИО работника": "Иванов")
    const labeled = Object.fromEntries(
      fields.map(f => [f.label, values[f.key] ?? ""]),
    );
    onSubmit(labeled);
  }

  const missing = fields.filter(f => f.required && !values[f.key]?.trim());

  return (
    <div className="compliance-checklist">
      <div className="compliance-checklist-header">
        <h2 className="compliance-checklist-title">Данные для документов</h2>
      </div>

      <p style={{ fontSize: 13, color: "#8B7355", margin: "0 0 20px" }}>
        Заполните поля — они подставятся в документы пакета. Всё можно отредактировать после.
      </p>

      <form onSubmit={handleSubmit} style={{ width: "100%" }}>
        {fields.map(field => (
          <div key={field.key} style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#8B7355", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
              {field.label}
              {field.required && <span style={{ color: "#c62828", marginLeft: 2 }}>*</span>}
            </label>
            <input
              type={field.type === "date" ? "date" : field.type === "money" || field.type === "number" ? "number" : "text"}
              value={values[field.key] ?? ""}
              onChange={e => set(field.key, e.target.value)}
              required={field.required}
              style={{
                width: "100%", boxSizing: "border-box",
                padding: "10px 14px", borderRadius: 10,
                border: "1px solid rgba(200,160,60,0.3)",
                background: "rgba(255,255,255,0.7)",
                fontSize: 14, color: "#1A0E00",
                outline: "none",
              }}
            />
            {field.type === "money" && (
              <div style={{ fontSize: 11, color: "#AAA098", marginTop: 3 }}>в копейках</div>
            )}
          </div>
        ))}

        {missing.length > 0 && (
          <p style={{ fontSize: 12, color: "#c62828", margin: "0 0 12px" }}>
            Заполните обязательные поля: {missing.map(f => f.label).join(", ")}
          </p>
        )}

        <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
          <button
            type="submit"
            className="compliance-assemble-btn"
            disabled={assembling || missing.length > 0}
            style={{ flex: 1, minWidth: 180 }}
          >
            {assembling ? "Собираем пакет…" : "Собрать пакет"}
          </button>
          <button type="button" className="paywall-back" onClick={onBack}>
            ← Назад
          </button>
        </div>
      </form>
    </div>
  );
}
