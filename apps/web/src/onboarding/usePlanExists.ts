import { useState, useEffect } from "react";
import { collection, query, limit, getDocs } from "firebase/firestore";
import { db } from "../firebase";

export function usePlanExists(businessId: string | null): { loading: boolean; exists: boolean } {
  const [loading, setLoading] = useState(true);
  const [exists, setExists] = useState(false);

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    Promise.all([
      getDocs(query(collection(db, `tenants/${businessId}/plan_intakes`), limit(1))),
      getDocs(query(collection(db, `tenants/${businessId}/plan_versions`), limit(1))),
    ]).then(([intakesSnap, versionsSnap]) => {
      setExists(!intakesSnap.empty || !versionsSnap.empty);
      setLoading(false);
    }).catch(() => { setLoading(false); });
  }, [businessId]);

  return { loading, exists };
}
