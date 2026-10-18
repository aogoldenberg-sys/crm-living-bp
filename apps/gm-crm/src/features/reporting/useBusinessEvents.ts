import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";
import { db } from "../../firebase";
import type { BusinessEvent } from "@crm/schemas";

const QUERY_KEY = (businessId: string) => ["events", businessId];

/**
 * Читает события payment_in/payment_out из tenants/{businessId}/events.
 * Используется для налогового расчёта (КУДиР, УСН).
 */
export function useBusinessEvents(businessId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!businessId) return;
    const colRef = collection(db, `tenants/${businessId}/events`);
    const q = query(colRef, orderBy("valueDate", "asc"), limit(2000));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const events: BusinessEvent[] = [];
        for (const doc of snap.docs) {
          const d = doc.data() as BusinessEvent;
          if (d.type === "payment_in" || d.type === "payment_out") events.push(d);
        }
        queryClient.setQueryData(QUERY_KEY(businessId), events);
      },
      (err) => console.error("useBusinessEvents onSnapshot error:", err),
    );

    return () => unsub();
  }, [businessId, queryClient]);

  return useQuery<BusinessEvent[]>({
    queryKey: QUERY_KEY(businessId),
    queryFn: () => [],
    enabled: !!businessId,
    staleTime: Infinity,
  });
}
