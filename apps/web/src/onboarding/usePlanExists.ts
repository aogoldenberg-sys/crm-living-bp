import { useState, useEffect } from "react";
import { collection, query, limit, getDocs } from "firebase/firestore";
import { db } from "../firebase";

export function usePlanExists(businessId: string | null): { loading: boolean; exists: boolean } {
  const [loading, setLoading] = useState(true);
  const [exists, setExists] = useState(false);

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    const colRef = collection(db, `tenants/${businessId}/plan_intakes`);
    const q = query(colRef, limit(1));
    getDocs(q).then(snap => {
      setExists(!snap.empty);
      setLoading(false);
    }).catch(() => { setLoading(false); });
  }, [businessId]);

  return { loading, exists };
}
