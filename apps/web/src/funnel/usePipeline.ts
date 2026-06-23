import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import type { Deal } from "./types";

const QUERY_KEY = (businessId: string, funnelId: string) =>
  ["pipeline", businessId, funnelId];

/**
 * Слушает коллекцию tenants/{businessId}/deals через onSnapshot.
 * Фильтрует по funnelId на стороне клиента (Firestore index не нужен для MVP).
 * Возвращает Map<dealId, Deal>.
 */
export function usePipeline(businessId: string, funnelId = "main") {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!businessId) return;
    const colRef = collection(db, `tenants/${businessId}/deals`);
    const unsub = onSnapshot(
      colRef,
      (snap) => {
        const deals = new Map<string, Deal>();
        for (const docSnap of snap.docs) {
          const deal = docSnap.data() as Deal;
          if (deal.funnelId === funnelId) {
            deals.set(deal.dealId, deal);
          }
        }
        queryClient.setQueryData(QUERY_KEY(businessId, funnelId), deals);
      },
      (err) => console.error("usePipeline error:", err),
    );
    return () => unsub();
  }, [businessId, funnelId, queryClient]);

  return useQuery<Map<string, Deal>>({
    queryKey: QUERY_KEY(businessId, funnelId),
    queryFn: () => new Map(),
    enabled: !!businessId,
    staleTime: Infinity,
  });
}
