import { useState, useCallback, useEffect } from "react";
import { collection, query, orderBy, limit, getDocs } from "firebase/firestore";
import { db, auth } from "../../firebase";
import { useAuth } from "../../auth/useAuth";
import type { ComplianceCase, FieldSpec } from "@crm/schemas";
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

const STORAGE_KEY = "kairos_compliance_case";

function loadCase(businessId: string): ComplianceCase | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}_${businessId}`);
    if (!raw) return null;
    return JSON.parse(raw) as ComplianceCase;
  } catch { return null; }
}

function saveCase(businessId: string, c: ComplianceCase | null) {
  if (c) localStorage.setItem(`${STORAGE_KEY}_${businessId}`, JSON.stringify(c));
  else localStorage.removeItem(`${STORAGE_KEY}_${businessId}`);
}

export function ComplianceFlow({ businessId, onCaseCreated, onRequestNewCase }: Props) {
  const [caseData, setCaseDataRaw] = useState<ComplianceCase | null>(() => loadCase(businessId));
  const [firestoreChecked, setFirestoreChecked] = useState(!!loadCase(businessId));
  const [requiredFields, setRequiredFields] = useState<FieldSpec[] | null>(null);
  const [assembling, setAssembling] = useState(false);
  const [assembleError, setAssembleError] = useState<string | null>(null);
  const { logout } = useAuth();

  // Если localStorage пуст — проверяем Firestore на существующие кейсы
  useEffect(() => {
    if (caseData || firestoreChecked) return;
    const q = query(
      collection(db, `tenants/${businessId}/compliance_cases`),
      orderBy("createdAt", "desc"),
      limit(1),
    );
    getDocs(q)
      .then((snap) => {
        if (!snap.empty) {
          const d = snap.docs[0];
          const loaded = { ...d.data(), caseId: d.id } as ComplianceCase;
          setCaseDataRaw(loaded);
          saveCase(businessId, loaded);
        }
      })
      .catch(() => {})
      .finally(() => setFirestoreChecked(true));
  }, [businessId, caseData, firestoreChecked]);

  const setCaseData = useCallback((c: ComplianceCase | null) => {
    setCaseDataRaw(c);
    saveCase(businessId, c);
  }, [businessId]);

  const handleNewCase = useCallback((c: ComplianceCase | null) => {
    setCaseData(c);
    if (c && onCaseCreated) onCaseCreated();
  }, [setCaseData, onCaseCreated]);

  const startNewCase = useCallback(() => {
    setCaseData(null);
    setRequiredFields(null);
    setAssembleError(null);
    if (onRequestNewCase) onRequestNewCase();
  }, [setCaseData, onRequestNewCase]);

  /** Вызывается пакетной сборкой с ответами пользователя (могут быть пустыми). */
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
        const updated = { ...caseData, status: "done", response: data.response as ComplianceCase["response"], documents: data.documents } as ComplianceCase;
        setCaseData(updated);
        setRequiredFields(null);
      }
    } catch (e) {
      setAssembleError(e instanceof Error ? e.message : "Ошибка сборки пакета");
    } finally {
      setAssembling(false);
    }
  }, [caseData, setCaseData]);

  /** Срабатывает на кнопке «Собрать пакет» в чек-листе. */
  const handleRequestAssemble = useCallback(async () => {
    if (!caseData) return;
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
        // Нет полей — сразу собираем
        await assemblePackage({});
      } else {
        setRequiredFields(fields);
      }
    } catch (e) {
      setAssembleError(e instanceof Error ? e.message : "Ошибка получения полей");
    }
  }, [caseData, assemblePackage]);

  if (!caseData && !firestoreChecked) {
    return <div className="loading-screen">Загрузка…</div>;
  }

  if (!caseData) {
    return <UploadStep onComplete={handleNewCase} />;
  }

  // Шаг ввода полей — между чек-листом и сборкой пакета
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

  switch (caseData.status) {
    case "extracting":
      return <ExtractingProgress stage="extracting" />;
    case "checklist_review":
    case "assembling":
      return (
        <ChecklistStep
          caseData={caseData}
          onChange={setCaseData}
          onNewCase={startNewCase}
          onLogout={() => void logout()}
          onRequestAssemble={handleRequestAssemble}
          assembling={assembling}
          assembleError={assembleError}
        />
      );
    case "response_draft":
      return <PackageStep caseData={caseData} onChange={setCaseData} />;
    case "done":
      return <DoneView caseData={caseData} onChange={setCaseData} onNewCase={startNewCase} onLogout={() => void logout()} />;
    default:
      return null;
  }
}
