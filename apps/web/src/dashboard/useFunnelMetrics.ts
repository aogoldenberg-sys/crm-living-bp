import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import type { FunnelMetrics, StageMetrics } from "@crm/core";

export interface FunnelMetricsResult {
  stages: StageMetrics[];
  totalDeals: number;
  loading: boolean;
}

/**
 * Читает tenants/{businessId}/funnel_metrics/{funnelId} через onSnapshot.
 * Паттерн: onSnapshot + useState + cleanup (без react-query — нет зависимости от QueryClient).
 */
export function useFunnelMetrics(
  businessId: string,
  funnelId = "main",
): FunnelMetricsResult {
  const [result, setResult] = useState<FunnelMetricsResult>({
    stages: [],
    totalDeals: 0,
    loading: true,
  });

  useEffect(() => {
    if (!businessId) {
      setResult({ stages: [], totalDeals: 0, loading: false });
      return;
    }

    const docRef = doc(
      db,
      `tenants/${businessId}/funnel_metrics/${funnelId}`,
    );

    const unsubscribe = onSnapshot(
      docRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as FunnelMetrics;
          const totalDeals = data.stages.reduce((sum, s) => sum + s.count, 0);
          setResult({ stages: data.stages, totalDeals, loading: false });
        } else {
          setResult({ stages: [], totalDeals: 0, loading: false });
        }
      },
      (err) => {
        console.error("dashboard/useFunnelMetrics onSnapshot error:", err);
        setResult({ stages: [], totalDeals: 0, loading: false });
      },
    );

    return () => unsubscribe();
  }, [businessId, funnelId]);

  return result;
}
