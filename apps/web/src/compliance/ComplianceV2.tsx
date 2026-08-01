import { useRef, useState } from "react";
import type { RequestItem, ChecklistEntry, RequestingAuthority } from "@crm/schemas";
import type { RegistryRow } from "./PackageResult.js";

export type ClarifyAnswer = {
  itemId: string;
  status: "have_paper" | "not_applicable" | "missing";
  note: string | null;
};

import { useAuth } from "../auth/useAuth";
import { PaywallScreen } from "../services/PaywallScreen";
import { RequestSummary } from "./RequestSummary";
import { RequisitesForm, type OrgRequisites } from "./RequisitesForm";
import { ClarifyDialog } from "./ClarifyDialog";
import { PackageResult } from "./PackageResult";

interface Props { businessId: string }

type Step =
  | "upload" | "review" | "requisites"
  | "clarify" | "clarify_confirm"
  | "assembling" | "done";

type GeneratedDoc = {
  docKind: string;
  title: string;
  content: string;
};

type State = {
  step: Step;
  caseId: string | null;
  authority: RequestingAuthority | null;
  items: RequestItem[];
  entries: ChecklistEntry[];
  checkedMap: Record<string, boolean>;
  openItems: RequestItem[];
  requisites: OrgRequisites | null;
  parsedAnswers: ClarifyAnswer[];
  letter: string;
  registry: RegistryRow[];
  clientPosition: string;
  generatedDocs: GeneratedDoc[];
  error: string | null;
  paywall: { reason: string; requiredTier?: string } | null;
};

const INITIAL: State = {
  step: "upload", caseId: null, authority: null,
  items: [], entries: [], checkedMap: {}, openItems: [],
  requisites: null, parsedAnswers: [],
  letter: "", registry: [], clientPosition: "", generatedDocs: [],
  error: null, paywall: null,
};

const WORKER = import.meta.env.VITE_INGEST_WORKER_URL as string;

export function ComplianceV2({ businessId: _businessId }: Props) {
  const { user } = useAuth();
  const [state, setState] = useState<State>(INITIAL);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function getToken(): Promise<string> { return user!.getIdToken(); }

  // ── Upload & extract ───────────────────────────────────────────────
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
        caseId?: string; items?: RequestItem[]; entries?: ChecklistEntry[];
        authority?: RequestingAuthority;
        error?: string; code?: string; requiredTier?: string;
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
      setState(s => ({
        ...s, step: "review",
        caseId: data.caseId!, items: data.items!, entries: data.entries!,
        authority: data.authority ?? null,
        openItems: [], checkedMap: {}, error: null,
      }));
    } catch (e) {
      setState(s => ({ ...s, error: e instanceof Error ? e.message : "Ошибка сети" }));
    }
  }

  // ── Confirm checkboxes → requisites ────────────────────────────────
  function handleChecklistConfirm(checked: Record<string, boolean>) {
    // Items where ALL their entries are unchecked and availability is missing_no_event
    const uncheckedMissing = new Set(
      state.entries
        .filter(e => e.availability === "missing_no_event" && !checked[e.entryId])
        .map(e => e.requestItemId),
    );
    const open = state.items.filter(it => uncheckedMissing.has(it.itemId));
    setState(s => ({ ...s, checkedMap: checked, openItems: open, step: "requisites" }));
  }

  // ── Requisites → clarify or package ────────────────────────────────
  function handleRequisites(r: OrgRequisites) {
    setState(s => ({ ...s, requisites: r }));
    if (state.openItems.length > 0) {
      setState(s => ({ ...s, step: "clarify" }));
    } else {
      void triggerPackage([], r);
    }
  }

  // ── Receive raw text → parse on server ─────────────────────────────
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

  function setParsedAnswerStatus(itemId: string, status: ClarifyAnswer["status"]) {
    setState(s => ({
      ...s,
      parsedAnswers: s.parsedAnswers.map(a => a.itemId === itemId ? { ...a, status } : a),
    }));
  }

  // ── Trigger package assembly ───────────────────────────────────────
  async function triggerPackage(answers: ClarifyAnswer[], reqOverride?: OrgRequisites) {
    setState(s => ({ ...s, step: "assembling", error: null }));
    const token = await getToken();
    const req = reqOverride ?? state.requisites;
    // Convert checked entries to "have_paper" answers for the pipeline
    const checkedAnswers: ClarifyAnswer[] = state.entries
      .filter(e => state.checkedMap[e.entryId] && e.availability === "missing_no_event")
      .map(e => ({ itemId: e.requestItemId, status: "have_paper" as const, note: null }));
    const allAnswers = [...checkedAnswers, ...answers];
    try {
      await fetch(`${WORKER}/compliance/package`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: state.caseId, answers: allAnswers,
          meta: req ? { companyName: req.companyName, companyInn: req.inn } : undefined,
        }),
      });
    } catch { /* polling covers it */ }
    startPolling();
  }

  // ── Poll ────────────────────────────────────────────────────────────
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
        generatedDocs?: GeneratedDoc[];
        packageError?: string;
      };
      if (data.status === "done" && data.response?.letterDraft) {
        if (pollRef.current) clearInterval(pollRef.current);
        setState(s => ({
          ...s, step: "done",
          letter: data.response!.letterDraft!,
          registry: data.registry ?? [],
          clientPosition: data.clientPosition ?? "",
          generatedDocs: data.generatedDocs ?? [],
        }));
      } else if (data.packageError) {
        if (pollRef.current) clearInterval(pollRef.current);
        setState(s => ({ ...s, step: "review", error: `Ошибка сборки: ${data.packageError}` }));
      }
    } catch { /* keep polling */ }
  }

  // ── Paywall ────────────────────────────────────────────────────────
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

  // ── Screens ────────────────────────────────────────────────────────
  if (state.step === "review") {
    return (
      <>
        {state.error && <p className="crm-v2-error">{state.error}</p>}
        <RequestSummary
          items={state.items}
          entries={state.entries}
          authority={state.authority ?? undefined}
          onConfirm={handleChecklistConfirm}
        />
      </>
    );
  }

  if (state.step === "requisites") {
    return <RequisitesForm onSubmit={handleRequisites} />;
  }

  if (state.step === "clarify") {
    return <ClarifyDialog openItems={state.openItems} onSubmit={a => { void handleClarifyText(a); }} />;
  }

  if (state.step === "clarify_confirm") {
    return <ClarifyConfirmScreen
      answers={state.parsedAnswers}
      openItems={state.openItems}
      error={state.error}
      onChangeStatus={setParsedAnswerStatus}
      onSubmit={() => { void triggerPackage(state.parsedAnswers); }}
    />;
  }

  if (state.step === "assembling") {
    return (
      <div className="crm-v2-panel">
        <p className="crm-v2-sub">Kairos собирает пакет\u2026</p>
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
        generatedDocs={state.generatedDocs}
      />
    );
  }

  // upload step
  return (
    <div className="crm-v2-panel crm-v2-upload-wrap">
      <div
        className="crm-v2-dropzone"
        onClick={() => inputRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void handleFile(f); }}
      >
        <div className="crm-v2-dropzone-icon">{"\uD83D\uDEE1"}</div>
        <p className="crm-v2-dropzone-title">Загрузите требование</p>
        <p className="crm-v2-dropzone-hint">PDF, JPEG, PNG или текстовый файл</p>
        <p className="crm-v2-dropzone-hint crm-v2-muted">Kairos разбирает запрос</p>
      </div>
      {state.error && <p className="crm-v2-error">{state.error}</p>}
      <input
        ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.txt"
        style={{ display: "none" }}
        onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
      />
    </div>
  );
}

// ── Extracted sub-component to stay under 200 lines ──────────────────

function ClarifyConfirmScreen({ answers, openItems, error, onChangeStatus, onSubmit }: {
  answers: ClarifyAnswer[];
  openItems: RequestItem[];
  error: string | null;
  onChangeStatus: (id: string, s: ClarifyAnswer["status"]) => void;
  onSubmit: () => void;
}) {
  const labelMap: Record<string, string> = {
    have_paper: "Есть на бумаге",
    not_applicable: "Не наша операция",
    missing: "Отсутствует",
  };
  return (
    <div className="crm-v2-panel">
      <h2 className="crm-v2-title">Проверьте распознанные ответы</h2>
      <p className="crm-v2-sub">При необходимости скорректируйте и нажмите "Собрать пакет".</p>
      {answers.map(ans => {
        const item = openItems.find(it => it.itemId === ans.itemId);
        const label = item
          ? (item.rawText.length > 80 ? item.rawText.slice(0, 80) + "\u2026" : item.rawText)
          : ans.itemId;
        return (
          <div key={ans.itemId} className="crm-v2-group">
            <p className="crm-v2-group-text">{label}</p>
            <select className="crm-v2-select" value={ans.status}
              onChange={e => onChangeStatus(ans.itemId, e.target.value as ClarifyAnswer["status"])}
            >
              <option value="have_paper">{labelMap.have_paper}</option>
              <option value="not_applicable">{labelMap.not_applicable}</option>
              <option value="missing">{labelMap.missing}</option>
            </select>
          </div>
        );
      })}
      {error && <p className="crm-v2-error">{error}</p>}
      <button type="button" className="crm-v2-btn" onClick={onSubmit}>Собрать пакет</button>
    </div>
  );
}
