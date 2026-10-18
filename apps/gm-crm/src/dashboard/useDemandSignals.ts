import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import type { DemandSignals } from "@crm/core";

export interface DemandSignalsResult {
  signals: DemandSignals | null;
  loading: boolean;
}

/**
 * Читает tenants/{businessId}/demand_signals/latest через onSnapshot.
 * Паттерн точно как useForecast: onSnapshot + cleanup.
 */
export function useDemandSignals(businessId: string): DemandSignalsResult {
  const [result, setResult] = useState<DemandSignalsResult>({
    signals: null,
    loading: true,
  });

  useEffect(() => {
    if (!businessId) {
      setResult({ signals: null, loading: false });
      return;
    }

    const docRef = doc(db, `tenants/${businessId}/demand_signals/latest`);

    const unsubscribe = onSnapshot(
      docRef,
      (snap) => {
        if (snap.exists()) {
          setResult({ signals: snap.data() as DemandSignals, loading: false });
        } else {
          setResult({ signals: null, loading: false });
        }
      },
      (err) => {
        console.error("useDemandSignals onSnapshot error:", err);
        setResult({ signals: null, loading: false });
      },
    );

    return () => unsubscribe();
  }, [businessId]);

  return result;
}
