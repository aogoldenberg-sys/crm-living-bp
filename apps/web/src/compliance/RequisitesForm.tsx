import { useState } from "react";

export type OrgRequisites = {
  companyName: string;
  inn: string;
  kpp: string;
  address: string;
  signerName: string;
  signerTitle: string;
};

const EMPTY: OrgRequisites = {
  companyName: "",
  inn: "",
  kpp: "",
  address: "",
  signerName: "",
  signerTitle: "",
};

interface Props {
  onSubmit: (r: OrgRequisites) => void;
}

export function RequisitesForm({ onSubmit }: Props) {
  const [form, setForm] = useState<OrgRequisites>(EMPTY);

  const set = (key: keyof OrgRequisites, val: string) =>
    setForm(prev => ({ ...prev, [key]: val }));

  const valid = form.companyName.trim() && form.inn.trim();

  return (
    <div className="crm-v2-panel">
      <h2 className="crm-v2-title">Реквизиты организации</h2>
      <p className="crm-v2-sub">
        Заполняются для каждого кейса отдельно.
      </p>

      <div className="crm-v2-group">
        <label className="crm-v2-label">Наименование *</label>
        <input className="crm-v2-input" value={form.companyName}
          onChange={e => set("companyName", e.target.value)} placeholder="ООО «Ромашка»" />
      </div>
      <div className="crm-v2-group">
        <label className="crm-v2-label">ИНН *</label>
        <input className="crm-v2-input" value={form.inn}
          onChange={e => set("inn", e.target.value)} placeholder="7701234567" />
      </div>
      <div className="crm-v2-group">
        <label className="crm-v2-label">КПП</label>
        <input className="crm-v2-input" value={form.kpp}
          onChange={e => set("kpp", e.target.value)} placeholder="770101001" />
      </div>
      <div className="crm-v2-group">
        <label className="crm-v2-label">Юридический адрес</label>
        <input className="crm-v2-input" value={form.address}
          onChange={e => set("address", e.target.value)} />
      </div>
      <div className="crm-v2-group">
        <label className="crm-v2-label">ФИО подписанта</label>
        <input className="crm-v2-input" value={form.signerName}
          onChange={e => set("signerName", e.target.value)} placeholder="Иванов Иван Иванович" />
      </div>
      <div className="crm-v2-group">
        <label className="crm-v2-label">Должность подписанта</label>
        <input className="crm-v2-input" value={form.signerTitle}
          onChange={e => set("signerTitle", e.target.value)} placeholder="Генеральный директор" />
      </div>

      <button type="button" className="crm-v2-btn" disabled={!valid}
        onClick={() => onSubmit(form)}>
        Продолжить
      </button>
    </div>
  );
}
