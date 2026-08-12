import { useRef, useState, useEffect } from "react";
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
import { AdvisoryView, type Advisory, type QA } from "./AdvisoryView";
import { CasesListView } from "../features/compliance/CasesListView";

interface Props { businessId: string }

type Step =
  | "cases" | "upload" | "review" | "requisites"
  | "clarify" | "clarify_confirm"
  | "assembling" | "done"
  | "advisory_pending" | "advisory_done"
  | "advisory_producing" | "advisory_produced";

type ProducedDoc = { title: string; content: string };

type GeneratedDoc = {
  docKind: string;
  title: string;
  content: string;
};

type State = {
  step: Step;
  caseId: string | null;
  authority: RequestingAuthority | null;
  documentClass: string | null;
  documentEssence: string;
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
  advisory: Advisory | null;
  advisoryIsRefined: boolean;
  producedDocs: ProducedDoc[];
  error: string | null;
  paywall: { reason: string; requiredTier?: string } | null;
};

const INITIAL: State = {
  step: "cases", caseId: null, authority: null,
  documentClass: null, documentEssence: "",
  items: [], entries: [], checkedMap: {}, openItems: [],
  requisites: null, parsedAnswers: [],
  letter: "", registry: [], clientPosition: "", generatedDocs: [],
  advisory: null, advisoryIsRefined: false, producedDocs: [],
  error: null, paywall: null,
};

const WORKER = import.meta.env.VITE_INGEST_WORKER_URL as string;

export function ComplianceV2({ businessId }: Props) {
  const { user } = useAuth();
  const [state, setState] = useState<State>(INITIAL);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Ref для caseId — poll() читает отсюда, не из стейл-замыкания state
  const caseIdRef = useRef<string | null>(null);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function getToken(): Promise<string> { return user!.getIdToken(); }

  // ── Open existing case ─────────────────────────────────────────────
  async function handleSelectCase(caseId: string) {
    try {
      const token = await getToken();
      const res = await fetch(`${WORKER}/compliance/case/${caseId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { setState(s => ({ ...s, step: "cases", error: "Не удалось открыть кейс" })); return; }
      // GET returns raw Firestore document — field names match caseData saved in extract handler.
      // Checklist entries are stored as "checklist" (not "entries"), items as "items".
      const data = await res.json() as {
        status?: string;
        documentClass?: string;
        hasItemList?: boolean;
        documentEssence?: string;
        authority?: RequestingAuthority;
        items?: RequestItem[];
        checklist?: ChecklistEntry[];
        advisory?: Advisory;
        response?: { letterDraft?: string };
        registry?: RegistryRow[];
        clientPosition?: string;
        generatedDocs?: GeneratedDoc[];
      };

      caseIdRef.current = caseId;

      // РЕШЕНИЕ: детектируем advisory так же, как handleFile — по hasItemList,
      // а не по значению documentClass, чтобы не промахнуться при новых классах.
      const isRequirement = data.documentClass === "requirement" && data.hasItemList === true;

      if (!isRequirement) {
        if (data.advisory) {
          setState(s => ({
            ...s, caseId, documentClass: data.documentClass ?? null,
            documentEssence: data.documentEssence ?? "",
            authority: data.authority ?? null,
            advisory: data.advisory!,
            step: "advisory_done", error: null,
          }));
        } else {
          // Advisory ещё не готов — polling
          setState(s => ({
            ...s, caseId, documentClass: data.documentClass ?? null,
            documentEssence: data.documentEssence ?? "",
            step: "advisory_pending", error: null,
          }));
          startPolling();
        }
        return;
      }

      if (data.status === "done" && data.response?.letterDraft) {
        setState(s => ({
          ...s, caseId, step: "done",
          letter: data.response!.letterDraft!,
          registry: data.registry ?? [],
          clientPosition: data.clientPosition ?? "",
          generatedDocs: data.generatedDocs ?? [],
          error: null,
        }));
        return;
      }

      // Requirement in progress — show checklist
      setState(s => ({
        ...s, caseId,
        documentClass: data.documentClass ?? null,
        documentEssence: data.documentEssence ?? "",
        authority: data.authority ?? null,
        items: data.items ?? [],
        entries: data.checklist ?? [],   // Firestore field: "checklist"
        checkedMap: {}, openItems: [],
        step: "review", error: null,
      }));
    } catch (e) {
      setState(s => ({ ...s, error: e instanceof Error ? e.message : "Ошибка сети" }));
    }
  }

  // ── Advisory trigger ───────────────────────────────────────────────
  async function triggerAdvisory(caseId: string, answers?: QA[]) {
    try {
      const token = await getToken();
      await fetch(`${WORKER}/compliance/advise`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, answers }),
      });
    } catch { /* polling picks up result */ }
    startPolling();
  }

  // ── Advisory answers (clarify round) ──────────────────────────────
  function handleAdvisoryAnswers(qa: QA[]) {
    if (!state.caseId) return;
    setState(s => ({ ...s, step: "advisory_pending", advisory: null, error: null, advisoryIsRefined: true }));
    void triggerAdvisory(state.caseId, qa);
  }

  // ── Extract text from advisory-branch file upload ──────────────────
  async function handleAdvisoryExtract(file: File): Promise<string> {
    const token = await getToken();
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("mimeType", file.type || "application/octet-stream");
    form.append("caseId", state.caseId!);
    const res = await fetch(`${WORKER}/compliance/advise/extract-text`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    const data = await res.json() as { extractedText?: string; error?: string };
    if (!res.ok || !data.extractedText) throw new Error(data.error ?? "Не удалось извлечь текст");
    return data.extractedText;
  }

  // ── Produce selected documents from advisory ───────────────────────
  async function handleAdvisoryProduce(selectedTitles: string[]) {
    setState(s => ({ ...s, step: "advisory_producing", error: null }));
    const token = await getToken();
    try {
      const res = await fetch(`${WORKER}/compliance/produce`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: state.caseId, selectedTitles }),
      });
      const data = await res.json() as { documents?: ProducedDoc[]; error?: string };
      if (!res.ok || !data.documents) {
        setState(s => ({ ...s, step: "advisory_done", error: data.error ?? "Ошибка генерации" }));
        return;
      }
      setState(s => ({ ...s, step: "advisory_produced", producedDocs: data.documents! }));
    } catch (e) {
      setState(s => ({ ...s, step: "advisory_done", error: e instanceof Error ? e.message : "Ошибка сети" }));
    }
  }

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
        authority?: RequestingAuthority; documentClass?: string;
        hasItemList?: boolean; essence?: string;
        error?: string; code?: string; requiredTier?: string;
      };
      if (res.status === 402) {
        setState(s => ({ ...s, paywall: { reason: data.error ?? "Требуется подписка", requiredTier: data.requiredTier } }));
        return;
      }
      if (res.status === 422 || data.code === "INSUFFICIENT_DATA") {
        setState(s => ({ ...s, error: "Документ не распознан. Загрузите чёткий скан." }));
        return;
      }
      if (!res.ok || !data.caseId) {
        setState(s => ({ ...s, error: data.error ?? `Ошибка ${res.status}` }));
        return;
      }

      const isRequirement = data.documentClass === "requirement" && data.hasItemList === true;

      if (!isRequirement) {
        caseIdRef.current = data.caseId!;
        setState(s => ({
          ...s, step: "advisory_pending",
          caseId: data.caseId!, documentClass: data.documentClass ?? null,
          documentEssence: data.essence ?? "", authority: data.authority ?? null,
          items: [], entries: [], error: null,
        }));
        void triggerAdvisory(data.caseId!);
        return;
      }

      if (!data.items || !data.entries) {
        setState(s => ({ ...s, error: data.error ?? `Ошибка ${res.status}` }));
        return;
      }
      caseIdRef.current = data.caseId!;
      setState(s => ({
        ...s, step: "review",
        caseId: data.caseId!, items: data.items!, entries: data.entries!,
        authority: data.authority ?? null, documentClass: data.documentClass ?? null,
        openItems: [], checkedMap: {}, error: null,
      }));
    } catch (e) {
      setState(s => ({ ...s, error: e instanceof Error ? e.message : "Ошибка сети" }));
    }
  }

  // ── Confirm checkboxes → requisites ────────────────────────────────
  function handleChecklistConfirm(checked: Record<string, boolean>) {
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
    const caseId = caseIdRef.current;
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
        advisory?: Advisory;
        advisoryError?: string;
        documentEssence?: string;
      };
      if (data.status === "done" && data.advisory) {
        if (pollRef.current) clearInterval(pollRef.current);
        setState(s => ({
          ...s, step: "advisory_done",
          advisory: data.advisory!,
          documentEssence: data.documentEssence ?? s.documentEssence,
        }));
      } else if (data.status === "done" && data.response?.letterDraft) {
        if (pollRef.current) clearInterval(pollRef.current);
        setState(s => ({
          ...s, step: "done",
          letter: data.response!.letterDraft!,
          registry: data.registry ?? [],
          clientPosition: data.clientPosition ?? "",
          generatedDocs: data.generatedDocs ?? [],
        }));
      } else if (data.packageError ?? data.advisoryError) {
        if (pollRef.current) clearInterval(pollRef.current);
        setState(s => ({
          ...s,
          step: s.step === "advisory_pending" ? "cases" : "review",
          error: `Ошибка: ${data.packageError ?? data.advisoryError}`,
        }));
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
  if (state.step === "cases") {
    return (
      <>
        {state.error && <p className="crm-v2-error" style={{ margin: "0 0 8px" }}>{state.error}</p>}
        <CasesListView
          businessId={businessId}
          onSelectCase={id => { void handleSelectCase(id); }}
          onNewCase={() => setState(s => ({ ...s, step: "upload", error: null }))}
        />
      </>
    );
  }

  if (state.step === "advisory_pending") {
    return (
      <div className="crm-v2-panel">
        {state.documentEssence && <p className="crm-v2-muted">{state.documentEssence}</p>}
        <p className="crm-v2-sub">{"Kairos анализирует документ\u2026"}</p>
      </div>
    );
  }

  if (state.step === "advisory_done" && state.advisory) {
    return (
      <AdvisoryView
        advisory={state.advisory}
        essence={state.documentEssence}
        caseId={state.caseId!}
        onBack={() => setState(s => ({ ...s, step: "cases", error: null }))}
        onReset={() => setState(INITIAL)}
        onAnswers={handleAdvisoryAnswers}
        onUploadFile={handleAdvisoryExtract}
        onProduce={handleAdvisoryProduce}
        isRefined={state.advisoryIsRefined}
      />
    );
  }

  if (state.step === "advisory_producing") {
    return (
      <div className="crm-v2-panel">
        <p className="crm-v2-sub">{"Kairos составляет документы\u2026"}</p>
      </div>
    );
  }

  if (state.step === "advisory_produced") {
    return (
      <div className="crm-v2-panel">
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <button type="button" className="crm-v2-btn-secondary" onClick={() => setState(s => ({ ...s, step: "advisory_done" }))}>
            ← К анализу
          </button>
          <button type="button" className="crm-v2-btn-secondary" onClick={() => setState(INITIAL)}>
            Новый кейс
          </button>
        </div>
        <h2 className="crm-v2-title">Готовые документы</h2>
        {state.error && <p className="crm-v2-error">{state.error}</p>}
        {state.producedDocs.map((doc, i) => (
          <section key={i} style={{ marginBottom: 16 }}>
            <h3 className="crm-v2-subtitle">{doc.title}</h3>
            <pre className="crm-v2-doc-content">{doc.content}</pre>
          </section>
        ))}
      </div>
    );
  }

  if (state.step === "review") {
    return (
      <>
        {state.error && <p className="crm-v2-error">{state.error}</p>}
        <div style={{ marginBottom: 8 }}>
          <button type="button" className="crm-v2-btn-secondary" onClick={() => setState(s => ({ ...s, step: "cases", error: null }))}>
            ← К списку кейсов
          </button>
        </div>
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
        <p className="crm-v2-sub">{"Kairos собирает пакет\u2026"}</p>
      </div>
    );
  }

  if (state.step === "done") {
    return (
      <>
        <div style={{ marginBottom: 8 }}>
          <button type="button" className="crm-v2-btn-secondary" onClick={() => setState(s => ({ ...s, step: "cases", error: null }))}>
            ← К списку кейсов
          </button>
        </div>
        <PackageResult
          caseId={state.caseId!}
          letter={state.letter}
          registry={state.registry}
          clientPosition={state.clientPosition}
          generatedDocs={state.generatedDocs}
        />
      </>
    );
  }

  // upload step
  return (
    <div className="crm-v2-panel crm-v2-upload-wrap">
      <div style={{ marginBottom: 8 }}>
        <button type="button" className="crm-v2-btn-secondary" onClick={() => setState(s => ({ ...s, step: "cases", error: null }))}>
          ← К списку кейсов
        </button>
      </div>
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
