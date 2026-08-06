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

function localKey(businessId: string) { return `kairos_entitlements_${businessId}`; }

function readLocal(businessId: string): { compliance?: boolean; report?: boolean } {
  try {
    return JSON.parse(localStorage.getItem(localKey(businessId)) ?? "{}");
  } catch { return {}; }
}

function writeLocal(businessId: string, patch: { compliance?: boolean; report?: boolean }) {
  const prev = readLocal(businessId);
  localStorage.setItem(localKey(businessId), JSON.stringify({ ...prev, ...patch }));
}

export function useEntitlements(businessId: string | null) {
  const [data, setData] = useState<Entitlements | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }

    // Старый баг помечал compliance: true при монтировании, даже без реальной работы.
    // Если флаг есть, но кейс не сохранён — сбрасываем ложный флаг.
    const local = readLocal(businessId);
    const caseKey = `kairos_compliance_case_${businessId}`;
    if (local.compliance && !localStorage.getItem(caseKey)) {
      local.compliance = false;
      writeLocal(businessId, { compliance: false });
    }

    const ref = doc(db, `tenants/${businessId}/_meta/entitlements`);
    getDoc(ref)
      .then((snap) => {
        if (snap.exists()) {
          const ent = snap.data() as Entitlements;
          if (local.compliance) ent.freeComplianceUsed = true;
          if (local.report) ent.freeReportUsed = true;
          setData(ent);
        } else {
          setData({
            ...DEFAULT,
            freeComplianceUsed: !!local.compliance,
            freeReportUsed: !!local.report,
            businessId,
            updatedAt: new Date().toISOString() as `${string}T${string}Z`,
          });
        }
      })
      .finally(() => setLoading(false));
  }, [businessId]);

  async function markComplianceUsed() {
    if (!businessId || !data) return;
    writeLocal(businessId, { compliance: true });
    setData({ ...data, freeComplianceUsed: true });
  }

  async function markReportUsed() {
    if (!businessId || !data) return;
    writeLocal(businessId, { report: true });
    setData({ ...data, freeReportUsed: true });
  }

  const canCompliance =
    !data || data.plan === "paid" || !data.freeComplianceUsed;

  const canReport =
    !data || data.plan === "paid" || !data.freeReportUsed;

  return { data, loading, canCompliance, canReport, markComplianceUsed, markReportUsed };
}
