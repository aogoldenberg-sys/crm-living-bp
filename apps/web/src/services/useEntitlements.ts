import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { Entitlements } from "@crm/schemas";

const DEFAULT: Omit<Entitlements, "businessId" | "updatedAt"> = {
  plan: "free",
  paidUntil: null,
  freeComplianceUsed: false,
  freeReportUsed: false,
  tier: "free",
  trialEndsAt: null,
  purchases: [],
  usage: { complianceCases: 0, taxReports: 0, planAssessRuns: 0 },
  internal: false,
};

export function useEntitlements(businessId: string | null) {
  const [data, setData] = useState<Entitlements | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }

    // Очищаем старый localStorage-мусор (предыдущая архитектура)
    localStorage.removeItem(`kairos_entitlements_${businessId}`);
    localStorage.removeItem(`kairos_compliance_case_${businessId}`);

    const ref = doc(db, `tenants/${businessId}/_meta/entitlements`);
    getDoc(ref)
      .then((snap) => {
        setData(snap.exists()
          ? snap.data() as Entitlements
          : { ...DEFAULT, businessId, updatedAt: new Date().toISOString() as `${string}T${string}Z` });
      })
      .finally(() => setLoading(false));
  }, [businessId]);

  // Единственный источник правды — usage.complianceCases из Firestore.
  // Инкрементируем локально после успешного создания кейса (воркер уже записал в Firestore).
  function markComplianceUsed() {
    if (!data) return Promise.resolve();
    setData({ ...data, usage: { ...data.usage, complianceCases: data.usage.complianceCases + 1 } });
    return Promise.resolve();
  }

  function markReportUsed() {
    if (!data) return Promise.resolve();
    setData({ ...data, usage: { ...data.usage, taxReports: data.usage.taxReports + 1 } });
    return Promise.resolve();
  }

  const paid = !data || data.plan === "paid" || data.tier !== "free" || !!data.trialEndsAt || data.internal === true;

  const canCompliance = paid || data.usage.complianceCases === 0;
  const canReport     = paid || data.usage.taxReports === 0;

  return { data, loading, canCompliance, canReport, markComplianceUsed, markReportUsed };
}
