import { useState } from "react";
import "./RevisionOnboarding.css";

interface Props {
  onComplete: () => void;
}

export function RevisionOnboarding({ onComplete }: Props) {
  const [inn, setInn] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"inn" | "confirm">("inn");
  const [companyName, setCompanyName] = useState("");

  async function handleInn() {
    if (inn.length < 10) return;
    setLoading(true);
    // Заглушка DaData — реальный запрос добавим позже
    await new Promise(r => setTimeout(r, 1200));
    setCompanyName(`ООО «Компания ${inn.slice(-4)}»`);
    setLoading(false);
    setStep("confirm");
  }

  if (step === "confirm") {
    return (
      <div className="ro-screen">
        <h2 className="ro-title">Нашли вашу компанию</h2>
        <div className="ro-card">
          <p className="ro-company">{companyName}</p>
          <p className="ro-inn">ИНН: {inn}</p>
        </div>
        <button className="ro-btn-primary" onClick={onComplete}>
          Перейти к книге бизнеса →
        </button>
        <button className="ro-btn-secondary" onClick={() => setStep("inn")}>
          Другой ИНН
        </button>
      </div>
    );
  }

  return (
    <div className="ro-screen">
      <h2 className="ro-title">Расскажите о бизнесе</h2>
      <p className="ro-sub">Введите ИНН — загрузим данные из реестра</p>
      <input
        className="ro-input"
        type="text"
        placeholder="ИНН (10 или 12 цифр)"
        value={inn}
        onChange={e => setInn(e.target.value.replace(/\D/g, "").slice(0, 12))}
        maxLength={12}
      />
      <button
        className="ro-btn-primary"
        onClick={() => void handleInn()}
        disabled={inn.length < 10 || loading}
      >
        {loading ? "Загружаем данные компании..." : "Продолжить"}
      </button>
      <button className="ro-btn-secondary" onClick={onComplete}>
        Пропустить
      </button>
    </div>
  );
}
