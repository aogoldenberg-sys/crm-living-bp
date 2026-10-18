import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import type { FunnelConfig } from "./types";

const QUERY_KEY = (businessId: string, funnelId: string) =>
  ["funnelConfig", businessId, funnelId];

export function useFunnelConfig(businessId: string, funnelId = "main") {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!businessId) return;
    const docRef = doc(db, `tenants/${businessId}/funnels/${funnelId}`);
    const unsub = onSnapshot(
      docRef,
      (snap) => {
        queryClient.setQueryData(
          QUERY_KEY(businessId, funnelId),
          snap.exists() ? (snap.data() as FunnelConfig) : null,
        );
      },
      (err) => console.error("useFunnelConfig error:", err),
    );
    return () => unsub();
  }, [businessId, funnelId, queryClient]);

  return useQuery<FunnelConfig | null>({
    queryKey: QUERY_KEY(businessId, funnelId),
    queryFn: () => null,
    enabled: !!businessId,
    staleTime: Infinity,
  });
}
