import { useState, useCallback } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db, auth } from "../../firebase";
import { useAuth } from "../../auth/useAuth";
import type { ComplianceCase, FieldSpec } from "@crm/schemas";
import { CasesListView } from "./CasesListView";
import { UploadStep } from "./UploadStep";
import { ExtractingProgress } from "./ExtractingProgress";
import { ChecklistStep } from "./ChecklistStep";
import { FieldsForm } from "./FieldsForm";
import { PackageStep } from "./PackageStep";
import { DoneView } from "./DoneView";

interface Props {
  businessId: string;
  onCaseCreated?: () => void;
  onRequestNewCase?: () => void;
}

type View = "list" | "upload";

export function ComplianceFlow({ businessId, onCaseCreated, onRequestNewCase }: Props) {
  const [view, setView] = useState<View>("list");
  const [caseData, setCaseData] = useState<ComplianceCase | null>(null);
  const [loadingCase, setLoadingCase] = useState(false);
  const [requiredFields, setRequiredFields] = useState<FieldSpec[] | null>(null);
  const [assembling, setAssembling] = useState(false);
  const [assembleError, setAssembleError] = useState<string | null>(null);
  const { logout } = useAuth();

  // Открыть конкретный кейс из истории
  const handleSelectCase = useCallback(async (caseId: string) => {
    setLoadingCase(true);
    try {
      const snap = await getDoc(doc(db, `tenants/${businessId}/compliance_cases`, caseId));
      if (snap.exists()) {
        setCaseData({ ...snap.data(), caseId: snap.id } as ComplianceCase);
      }
    } catch { /* ignore */ } finally {
      setLoadingCase(false);
    }
  }, [businessId]);

  // Новый кейс — показать экран загрузки файла
  const handleNewCase = useCallback(() => {
    setCaseData(null);
    setRequiredFields(null);
    setAssembleError(null);
    setView("upload");
    if (onRequestNewCase) onRequestNewCase();
  }, [onRequestNewCase]);

  // Вернуться в список
  const handleBackToList = useCallback(() => {
    setCaseData(null);
    setRequiredFields(null);
    setAssembleError(null);
    setView("list");
  }, []);

  // После загрузки нового документа
  const handleCaseCreated = useCallback((c: ComplianceCase | null) => {
    if (c) {
      setCaseData(c);
      setView("list"); // view не важен — caseData есть, рендерим кейс
      if (onCaseCreated) onCaseCreated();
    }
  }, [onCaseCreated]);

  // Сборка пакета
  const assemblePackage = useCallback(async (answers: Record<string, string>) => {
    if (!caseData) return;
    setAssembling(true);
    setAssembleError(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Не авторизован");
      const idToken = await user.getIdToken();
      const workerUrl = import.meta.env.VITE_INGEST_WORKER_URL as string;
      const res = await fetch(`${workerUrl}/compliance/package`, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: caseData.caseId, checklist: caseData.checklist, answers }),
      });
      const data = await res.json().catch(() => ({})) as {
        error?: string; status?: string;
        response?: Record<string, unknown>;
        documents?: Array<{ fileName: string; title: string; content: string }>;
      };
      if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`);
      if (data.status === "done" && data.response) {
        setCaseData(prev => prev ? {
          ...prev, status: "done",
          response: data.response as ComplianceCase["response"],
          documents: data.documents,
        } as ComplianceCase : prev);
        setRequiredFields(null);
      }
    } catch (e) {
      setAssembleError(e instanceof Error ? e.message : "Ошибка сборки пакета");
    } finally {
      setAssembling(false);
    }
  }, [caseData]);

  const handleRequestAssemble = useCallback(async () => {
    if (!caseData) return;
    setAssembling(true);
    setAssembleError(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Не авторизован");
      const idToken = await user.getIdToken();
      const workerUrl = import.meta.env.VITE_INGEST_WORKER_URL as string;
      const res = await fetch(`${workerUrl}/compliance/case/${caseData.caseId}/required-fields`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json().catch(() => ({ fields: [] })) as { fields?: FieldSpec[] };
      const fields = data.fields ?? [];
      if (fields.length === 0) {
        await assemblePackage({});
      } else {
        setAssembling(false);
        setRequiredFields(fields);
      }
    } catch (e) {
      setAssembling(false);
      setAssembleError(e instanceof Error ? e.message : "Ошибка получения полей");
    }
  }, [caseData, assemblePackage]);

  // ── Рендер ──────────────────────────────────────────────────────────────────

  if (loadingCase) return <div className="loading-screen">Загрузка…</div>;

  // Нет активного кейса — список или загрузка нового
  if (!caseData) {
    if (view === "upload") {
      return <UploadStep onComplete={handleCaseCreated} onBack={handleBackToList} />;
    }
    return (
      <CasesListView
        businessId={businessId}
        onSelectCase={handleSelectCase}
        onNewCase={handleNewCase}
      />
    );
  }

  // Форма доп. полей (между чек-листом и сборкой)
  if ((caseData.status === "checklist_review" || caseData.status === "assembling") && requiredFields) {
    return (
      <FieldsForm
        fields={requiredFields}
        onSubmit={assemblePackage}
        onBack={() => setRequiredFields(null)}
        assembling={assembling}
      />
    );
  }

  // Активный кейс
  switch (caseData.status) {
    case "extracting":
      return <ExtractingProgress stage="extracting" />;
    case "checklist_review":
    case "assembling":
      return (
        <ChecklistStep
          caseData={caseData}
          onChange={setCaseData}
          onNewCase={handleBackToList}
          onLogout={() => void logout()}
          onRequestAssemble={handleRequestAssemble}
          assembling={assembling}
          assembleError={assembleError}
        />
      );
    case "response_draft":
      return <PackageStep caseData={caseData} onChange={setCaseData} />;
    case "done":
      return (
        <DoneView
          caseData={caseData}
          onChange={setCaseData}
          onNewCase={handleBackToList}
          onLogout={() => void logout()}
        />
      );
    default:
      return null;
  }
}
