import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { Entitlements } from "@crm/schemas";

const DEFAULT: Omit<Entitlements, "businessId" | "updatedAt"> = {
  plan: "free",
  paidUntil: null,
  freeComplianceUsed: false,
  freeReportUsed: false,
};

export function useEntitlements(businessId: string | null) {
  const [data, setData] = useState<Entitlements | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    const ref = doc(db, `tenants/${businessId}/_meta/entitlements`);
    getDoc(ref)
      .then((snap) => {
        if (snap.exists()) {
          setData(snap.data() as Entitlements);
        } else {
          // Doc not yet created by Worker — use in-memory defaults (no client writes per arch rules)
          setData({ ...DEFAULT, businessId, updatedAt: new Date().toISOString() as `${string}T${string}Z` });
        }
      })
      .finally(() => setLoading(false));
  }, [businessId]);

  async function markComplianceUsed() {
    if (!businessId || !data) return;
    const updated = {
      ...data,
      freeComplianceUsed: true,
      updatedAt: new Date().toISOString() as `${string}T${string}Z`,
    };
    const ref = doc(db, `tenants/${businessId}/_meta/entitlements`);
    await setDoc(ref, updated);
    setData(updated);
  }

  async function markReportUsed() {
    if (!businessId || !data) return;
    const updated = {
      ...data,
      freeReportUsed: true,
      updatedAt: new Date().toISOString() as `${string}T${string}Z`,
    };
    const ref = doc(db, `tenants/${businessId}/_meta/entitlements`);
    await setDoc(ref, updated);
    setData(updated);
  }

  const canCompliance =
    !data || data.plan === "paid" || !data.freeComplianceUsed;

  const canReport =
    !data || data.plan === "paid" || !data.freeReportUsed;

  return { data, loading, canCompliance, canReport, markComplianceUsed, markReportUsed };
}
