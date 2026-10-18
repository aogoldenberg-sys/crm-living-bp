import { useState, useEffect } from "react";
import { collection, query, limit, getDocs } from "firebase/firestore";
import { db } from "../firebase";

export function usePlanExists(businessId: string | null): { loading: boolean; exists: boolean } {
  const [loading, setLoading] = useState(true);
  const [exists, setExists] = useState(false);

  useEffect(() => {
    // Reset state on every businessId change — prevents stale false-exists from null run
    setLoading(true);
    setExists(false);

    if (!businessId) { setLoading(false); return; }

    let cancelled = false;
    Promise.all([
      getDocs(query(collection(db, `tenants/${businessId}/plan_intakes`), limit(1))),
      getDocs(query(collection(db, `tenants/${businessId}/plan_versions`), limit(1))),
    ]).then(([intakesSnap, versionsSnap]) => {
      if (cancelled) return;
      setExists(!intakesSnap.empty || !versionsSnap.empty);
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [businessId]);

  return { loading, exists };
}
