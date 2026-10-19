import { useMemo } from "react";
import { useOrdersArchive, useOrdersFeed, withArchive } from "./ordersStore";

function normPhone(p: string): string {
  return p.replace(/\D/g, "").slice(-10);
}

/** Map<normPhone10, clientName> — общий поток заказов + архив (звонят и старые клиенты) */
export function useClientPhoneMap(businessId: string): Map<string, string> {
  const feed = useOrdersFeed(businessId);
  const archive = useOrdersArchive(businessId, true, feed.archiveRev);

  return useMemo(() => {
    const m = new Map<string, string>();
    for (const o of archive ? withArchive(feed.orders, archive) : feed.orders) {
      if (!o.phone || !o.customerName) continue;
      const norm = normPhone(o.phone);
      if (norm && !m.has(norm)) m.set(norm, o.customerName);
    }
    return m;
  }, [feed.orders, archive]);
}

export { normPhone };
