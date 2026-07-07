import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { EmptyState } from "./EmptyState";
import { Questionnaire } from "./Questionnaire";
import { UploadPlanButton } from "../dashboard/UploadPlanButton";
import type { Answers } from "./questions";

type Stage = "empty" | "questionnaire" | "upload" | "generating";

export function OnboardingFlow() {
  const [stage, setStage] = useState<Stage>("empty");
  const [generateError, setGenerateError] = useState<string | null>(null);
  const lastAnswers = useRef<Answers>({});
  const { user } = useAuth();
  const navigate = useNavigate();

  async function runGenerate(answers: Answers) {
    setGenerateError(null);
    setStage("generating");
    try {
      const idToken = await user!.getIdToken();
      const workerUrl = import.meta.env.VITE_INGEST_WORKER_URL as string;
      const res = await fetch(`${workerUrl}/generate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? "Ошибка генерации");
      }
      navigate("/dashboard");
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "Ошибка генерации. Попробуйте ещё раз.");
    }
  }

  async function handleSubmitAnswers(answers: Answers) {
    lastAnswers.current = answers;
    await runGenerate(answers);
  }

  if (stage === "questionnaire") {
    return (
      <Questionnaire
        onSubmit={handleSubmitAnswers}
        onHome={() => setStage("empty")}
      />
    );
  }

  if (stage === "upload") {
    return (
      <div className="generating-screen ob-upload">
        <button
          className="qs-btn qs-btn--back"
          onClick={() => setStage("empty")}
        >
          ← Назад
        </button>
        <h2 className="ob-upload__title">Загрузите бизнес-план</h2>
        <p className="ob-upload__sub">PDF, Word, Excel, текст — перетащите или выберите файл</p>
        <div className="ob-upload__zone">
          <UploadPlanButton onSuccess={() => navigate("/dashboard")} />
        </div>
        <button
          className="qs-btn qs-btn--back"
          style={{ marginTop: "var(--space-4)" }}
          onClick={() => setStage("questionnaire")}
        >
          Нет плана — создать с нуля
        </button>
      </div>
    );
  }

  if (stage === "generating") {
    return (
      <div className="generating-screen">
        {generateError ? (
          <>
            <p className="generating-text" style={{ color: "var(--color-danger, #e53e3e)" }}>
              {generateError}
            </p>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", marginTop: "1.5rem" }}>
              <button
                className="qs-btn qs-btn--primary"
                onClick={() => void runGenerate(lastAnswers.current)}
              >
                Повторить
              </button>
              <button
                className="qs-btn qs-btn--back"
                onClick={() => setStage("questionnaire")}
              >
                Назад к анкете
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="generating-text">Генерируем ваш финансовый план…</p>
            <p className="generating-hint">Обычно занимает 15–30 секунд</p>
          </>
        )}
      </div>
    );
  }

  // stage === "empty"
  return (
    <EmptyState
      onBusiness={() => setStage("upload")}
      onReporting={() => navigate("/services?tab=tax")}
      onCompliance={() => navigate("/services?tab=compliance")}
    />
  );
}
