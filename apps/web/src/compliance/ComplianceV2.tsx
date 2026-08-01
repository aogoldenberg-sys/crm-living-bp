import { useRef, useState } from "react";
import type { RequestItem, ChecklistEntry } from "@crm/schemas";
import type { RegistryRow } from "./PackageResult.js";

export type ClarifyAnswer = {
  itemId: string;
  status: "have_paper" | "not_applicable" | "missing";
  note: string | null;
};
import { useAuth } from "../auth/useAuth";
import { PaywallScreen } from "../services/PaywallScreen";
import { RequestSummary } from "./RequestSummary";
import { ClarifyDialog } from "./ClarifyDialog";
import { PackageResult } from "./PackageResult";

interface Props {
  businessId: string;
}

type Step = "upload" | "review" | "clarify" | "clarify_confirm" | "assembling" | "done";

type State = {
  step: Step;
  caseId: string | null;
  items: RequestItem[];
  entries: ChecklistEntry[];
  openItems: RequestItem[];
  parsedAnswers: ClarifyAnswer[];
  letter: string;
  registry: RegistryRow[];
  clientPosition: string;
  error: string | null;
  paywall: { reason: string; requiredTier?: string } | null;
};

const INITIAL: State = {
  step: "upload",
  caseId: null,
  items: [],
  entries: [],
  openItems: [],
  parsedAnswers: [],
  letter: "",
  registry: [],
  clientPosition: "",
  error: null,
  paywall: null,
};

const WORKER = import.meta.env.VITE_INGEST_WORKER_URL as string;

export function ComplianceV2({ businessId: _businessId }: Props) {
  const { user } = useAuth();
  const [state, setState] = useState<State>(INITIAL);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function getToken(): Promise<string> {
    return user!.getIdToken();
  }

  // ── Upload & extract ─────────────────────────────────────────────────────────
  async function handleFile(file: File) {
    setState(s => ({ ...s, step: "upload", error: null }));

    const mime = file.type || (file.name.endsWith(".pdf") ? "application/pdf" : "image/jpeg");
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("mimeType", mime);

    try {
      const token = await getToken();
      const res = await fetch(`${WORKER}/compliance/extract`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      const data = await res.json().catch(() => ({})) as {
        caseId?: string;
        items?: RequestItem[];
        entries?: ChecklistEntry[];
        error?: string;
        code?: string;
        requiredTier?: string;
      };

      if (res.status === 402) {
        setState(s => ({ ...s, paywall: { reason: data.error ?? "Требуется подписка", requiredTier: data.requiredTier } }));
        return;
      }
      if (res.status === 422 || data.code === "INSUFFICIENT_DATA") {
        setState(s => ({ ...s, error: "Документ не распознан как требование. Загрузите чёткий скан." }));
        return;
      }
      if (!res.ok || !data.caseId || !data.items || !data.entries) {
        setState(s => ({ ...s, error: data.error ?? `Ошибка ${res.status}` }));
        return;
      }

      const open = data.items.filter(it =>
        data.entries!.some(e => e.requestItemId === it.itemId && e.availability === "missing_no_event"),
      );

      setState(s => ({
        ...s,
        step: "review",
        caseId: data.caseId!,
        items: data.items!,
        entries: data.entries!,
        openItems: open,
        error: null,
      }));
    } catch (e) {
      setState(s => ({ ...s, error: e instanceof Error ? e.message : "Ошибка сети" }));
    }
  }

  // ── Confirm from RequestSummary ───────────────────────────────────────────────
  function handleConfirm() {
    if (state.openItems.length > 0) {
      setState(s => ({ ...s, step: "clarify" }));
    } else {
      void triggerPackage([]);
    }
  }

  // ── Receive raw text from ClarifyDialog → parse on server ────────────────────
  async function handleClarifyText(userAnswer: string) {
    const token = await getToken();
    try {
      const res = await fetch(`${WORKER}/compliance/clarify`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: state.caseId, userAnswer }),
      });
      const data = await res.json().catch(() => ({})) as { answers?: ClarifyAnswer[]; error?: string };
      if (!res.ok || !data.answers) {
        setState(s => ({ ...s, error: data.error ?? `Ошибка ${res.status}` }));
        return;
      }
      setState(s => ({ ...s, step: "clarify_confirm", parsedAnswers: data.answers! }));
    } catch (e) {
      setState(s => ({ ...s, error: e instanceof Error ? e.message : "Ошибка сети" }));
    }
  }

  // ── Update a single parsed answer (manual correction) ────────────────────────
  function setParsedAnswerStatus(itemId: string, status: ClarifyAnswer["status"]) {
    setState(s => ({
      ...s,
      parsedAnswers: s.parsedAnswers.map(a => a.itemId === itemId ? { ...a, status } : a),
    }));
  }

  // ── Trigger package assembly ──────────────────────────────────────────────────
  async function triggerPackage(answers: ClarifyAnswer[]) {
    setState(s => ({ ...s, step: "assembling", error: null }));
    const token = await getToken();
    try {
      await fetch(`${WORKER}/compliance/package`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: state.caseId, answers }),
      });
    } catch {
      // assembling in background, poll regardless
    }
    startPolling();
  }

  // ── Poll until done ───────────────────────────────────────────────────────────
  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => { void poll(); }, 3000);
  }

  async function poll() {
    const { caseId } = state;
    if (!caseId) return;
    try {
      const token = await getToken();
      const res = await fetch(`${WORKER}/compliance/case/${caseId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json() as {
        status?: string;
        response?: { letterDraft?: string };
        registry?: RegistryRow[];
        clientPosition?: string;
        packageError?: string;
      };
      if (data.status === "done" && data.response?.letterDraft) {
        if (pollRef.current) clearInterval(pollRef.current);
        setState(s => ({
          ...s,
          step: "done",
          letter: data.response!.letterDraft!,
          registry: data.registry ?? [],
          clientPosition: data.clientPosition ?? "",
        }));
      } else if (data.packageError) {
        if (pollRef.current) clearInterval(pollRef.current);
        setState(s => ({ ...s, step: "review", error: `Ошибка сборки: ${data.packageError}` }));
      }
    } catch { /* keep polling */ }
  }

  // ── Paywall ──────────────────────────────────────────────────────────────────
  if (state.paywall) {
    return (
      <PaywallScreen
        reason={state.paywall.reason}
        requiredTier={state.paywall.requiredTier}
        onClose={() => setState(s => ({ ...s, paywall: null }))}
        onRetry={() => { setState(INITIAL); }}
      />
    );
  }

  // ── Screens ───────────────────────────────────────────────────────────────────
  if (state.step === "review") {
    return (
      <>
        {state.error && <p className="crm-v2-error">{state.error}</p>}
        <RequestSummary items={state.items} entries={state.entries} onConfirm={handleConfirm} />
      </>
    );
  }

  if (state.step === "clarify") {
    return <ClarifyDialog openItems={state.openItems} onSubmit={a => { void handleClarifyText(a); }} />;
  }

  if (state.step === "clarify_confirm") {
    const labelMap: Record<string, string> = {
      have_paper: "Есть на бумаге",
      not_applicable: "Не наша операция",
      missing: "Отсутствует",
    };
    return (
      <div className="crm-v2-panel">
        <h2 className="crm-v2-title">Проверьте распознанные ответы</h2>
        <p className="crm-v2-sub">При необходимости скорректируйте и нажмите «Собрать пакет».</p>
        {state.parsedAnswers.map(ans => {
          const item = state.openItems.find(it => it.itemId === ans.itemId);
          const label = item
            ? (item.rawText.length > 80 ? item.rawText.slice(0, 80) + "…" : item.rawText)
            : ans.itemId;
          return (
            <div key={ans.itemId} className="crm-v2-group">
              <p className="crm-v2-group-text">{label}</p>
              <select
                className="crm-v2-select"
                value={ans.status}
                onChange={e => setParsedAnswerStatus(ans.itemId, e.target.value as ClarifyAnswer["status"])}
              >
                <option value="have_paper">{labelMap.have_paper}</option>
                <option value="not_applicable">{labelMap.not_applicable}</option>
                <option value="missing">{labelMap.missing}</option>
              </select>
            </div>
          );
        })}
        {state.error && <p className="crm-v2-error">{state.error}</p>}
        <button type="button" className="crm-v2-btn" onClick={() => { void triggerPackage(state.parsedAnswers); }}>
          Собрать пакет
        </button>
      </div>
    );
  }

  if (state.step === "assembling") {
    return (
      <div className="crm-v2-panel">
        <p className="crm-v2-sub">Собираем пакет…</p>
      </div>
    );
  }

  if (state.step === "done") {
    return (
      <PackageResult
        caseId={state.caseId!}
        letter={state.letter}
        registry={state.registry}
        clientPosition={state.clientPosition}
      />
    );
  }

  // upload step
  return (
    <div className="crm-v2-panel">
      <div
        className="crm-v2-dropzone"
        onClick={() => inputRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void handleFile(f); }}
      >
        <div className="crm-v2-dropzone-icon">🛡</div>
        <p className="crm-v2-dropzone-title">Загрузите требование</p>
        <p className="crm-v2-dropzone-hint">PDF, JPEG, PNG или текстовый файл</p>
      </div>
      {state.error && <p className="crm-v2-error">{state.error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.txt"
        style={{ display: "none" }}
        onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
      />
    </div>
  );
}
