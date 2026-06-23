import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import type { FunnelMetrics } from "./types";

const QUERY_KEY = (businessId: string, funnelId: string) =>
  ["funnelMetrics", businessId, funnelId];

export function useFunnelMetrics(businessId: string, funnelId = "main") {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!businessId) return;
    const docRef = doc(db, `tenants/${businessId}/funnel_metrics/${funnelId}`);
    const unsub = onSnapshot(
      docRef,
      (snap) => {
        queryClient.setQueryData(
          QUERY_KEY(businessId, funnelId),
          snap.exists() ? (snap.data() as FunnelMetrics) : null,
        );
      },
      (err) => console.error("useFunnelMetrics error:", err),
    );
    return () => unsub();
  }, [businessId, funnelId, queryClient]);

  return useQuery<FunnelMetrics | null>({
    queryKey: QUERY_KEY(businessId, funnelId),
    queryFn: () => null,
    enabled: !!businessId,
    staleTime: Infinity,
  });
}
