import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { EmptyState } from "./EmptyState";
import { Questionnaire } from "./Questionnaire";
import type { Answers } from "./questions";

type Stage = "empty" | "questionnaire" | "generating";

export function OnboardingFlow() {
  const [stage, setStage] = useState<Stage>("empty");
  const { user } = useAuth();
  const navigate = useNavigate();

  async function handleSubmitAnswers(answers: Answers) {
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
      // Plan created — navigate to dashboard (useIntake will pick it up)
      navigate("/dashboard");
    } catch (e) {
      setStage("questionnaire");
      throw e;
    }
  }

  if (stage === "questionnaire") {
    return <Questionnaire onSubmit={handleSubmitAnswers} />;
  }

  if (stage === "generating") {
    return (
      <div className="generating-screen">
        <p className="generating-text">Генерируем ваш финансовый план…</p>
        <p className="generating-hint">Обычно занимает 15–30 секунд</p>
      </div>
    );
  }

  // stage === "empty"
  return <EmptyState onNoplan={() => setStage("questionnaire")} />;
}
