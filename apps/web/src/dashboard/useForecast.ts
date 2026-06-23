import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";

export interface DailyBalance {
  date: string;
  p10: number; // kopecks
  p50: number; // kopecks
  p90: number; // kopecks
}

export interface CashForecast {
  dailyBalances: DailyBalance[];
  gapDate: string | null;
  gapAmount: number | null; // kopecks
  confidence: number;
}

const QUERY_KEY = (businessId: string) => ["forecast", businessId];

export function useForecast(businessId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!businessId) return;

    const docRef = doc(db, `tenants/${businessId}/cash_forecast/latest`);

    const unsubscribe = onSnapshot(
      docRef,
      (snap) => {
        if (snap.exists()) {
          queryClient.setQueryData(QUERY_KEY(businessId), snap.data() as CashForecast);
        } else {
          queryClient.setQueryData(QUERY_KEY(businessId), null);
        }
      },
      (err) => {
        console.error("useForecast onSnapshot error:", err);
      }
    );

    return () => unsubscribe();
  }, [businessId, queryClient]);

  return useQuery<CashForecast | null>({
    queryKey: QUERY_KEY(businessId),
    queryFn: () => null, // данные приходят через onSnapshot
    enabled: !!businessId,
    staleTime: Infinity,
  });
}
