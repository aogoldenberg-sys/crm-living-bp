import { useState, useCallback, useEffect } from "react";
import { collection, query, orderBy, limit, getDocs } from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../../auth/useAuth";
import type { ComplianceCase } from "@crm/schemas";
import { UploadStep } from "./UploadStep";
import { ExtractingProgress } from "./ExtractingProgress";
import { ChecklistStep } from "./ChecklistStep";
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
    if (onRequestNewCase) onRequestNewCase();
  }, [setCaseData, onRequestNewCase]);

  if (!caseData && !firestoreChecked) {
    return <div className="loading-screen">Загрузка…</div>;
  }

  if (!caseData) {
    return <UploadStep onComplete={handleNewCase} />;
  }

  switch (caseData.status) {
    case "extracting":
      return <ExtractingProgress stage="extracting" />;
    case "checklist_review":
      return <ChecklistStep caseData={caseData} onChange={setCaseData} onNewCase={startNewCase} onLogout={() => void logout()} />;
    case "assembling":
      return <ChecklistStep caseData={caseData} onChange={setCaseData} onNewCase={startNewCase} onLogout={() => void logout()} />;
    case "response_draft":
      return <PackageStep caseData={caseData} onChange={setCaseData} />;
    case "done":
      return <DoneView caseData={caseData} onChange={setCaseData} onNewCase={startNewCase} onLogout={() => void logout()} />;
    default:
      return null;
  }
}
