import { useState, useEffect } from "react";
import { collection, query, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";

function normPhone(p: string): string {
  return p.replace(/\D/g, "").slice(-10);
}

/** Map<normPhone10, clientName> — строится из заказов в реальном времени */
export function useClientPhoneMap(businessId: string): Map<string, string> {
  const [map, setMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    return onSnapshot(query(collection(db, `tenants/${businessId}/orders`)), snap => {
      const m = new Map<string, string>();
      snap.docs.forEach(d => {
        const data = d.data() as { customerName?: string; phone?: string };
        if (data.phone && data.customerName) {
          const norm = normPhone(data.phone);
          if (norm && !m.has(norm)) m.set(norm, data.customerName);
        }
      });
      setMap(m);
    }, () => {});
  }, [businessId]);

  return map;
}

export { normPhone };
