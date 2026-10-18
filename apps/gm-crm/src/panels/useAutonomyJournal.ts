import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  collection,
  doc,
  query,
  orderBy,
  limit,
  onSnapshot,
  getDoc,
} from "firebase/firestore";
import { db } from "../firebase";

export interface AutonomyConfig {
  level: "A1" | "A2" | "A3" | "A4";
  maxBudgetShiftKopecks: number;
  allowedActions: string[];
  requireConfirmationFor: string[];
}

export interface JournalRow {
  entryId: string;
  actionId: string;
  configuredLevel: string;
  requiredLevel: string;
  decidedAt: string;
  verdict: "execute" | "ask_human" | "insufficient_data";
  reason: string;
  applied: boolean;
}

const JOURNAL_QUERY_KEY = (bid: string) => ["autonomy_journal", bid];
const CONFIG_QUERY_KEY = (bid: string) => ["autonomy_config", bid];

function normalizeRow(raw: Record<string, unknown>): JournalRow {
  return {
    entryId: String(raw.entryId ?? ""),
    actionId: String(raw.actionId ?? ""),
    configuredLevel: String(raw.configuredLevel ?? "A1"),
    requiredLevel: String(raw.requiredLevel ?? "A1"),
    decidedAt: String(raw.decidedAt ?? ""),
    verdict: (raw.verdict as JournalRow["verdict"]) ?? "ask_human",
    reason: String(raw.reason ?? ""),
    applied: Boolean(raw.applied),
  };
}

export function useAutonomyJournal(businessId: string) {
  const queryClient = useQueryClient();

  // ── Config: tenants/{bid}/autonomy_config/current ─────────────────────────
  useEffect(() => {
    if (!businessId) return;
    void getDoc(doc(db, `tenants/${businessId}/autonomy_config`, "current")).then((snap) => {
      queryClient.setQueryData(
        CONFIG_QUERY_KEY(businessId),
        snap.exists() ? (snap.data() as AutonomyConfig) : null,
      );
    });
  }, [businessId, queryClient]);

  // ── Journal: tenants/{bid}/autonomy_journal (last 20 entries) ─────────────
  useEffect(() => {
    if (!businessId) return;
    const colRef = collection(db, `tenants/${businessId}/autonomy_journal`);
    const q = query(colRef, orderBy("decidedAt", "desc"), limit(20));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) =>
          normalizeRow(d.data() as Record<string, unknown>),
        );
        queryClient.setQueryData(JOURNAL_QUERY_KEY(businessId), rows);
      },
      (err) => {
        console.error("useAutonomyJournal:", err);
      },
    );
    return () => unsubscribe();
  }, [businessId, queryClient]);

  const journal = useQuery<JournalRow[]>({
    queryKey: JOURNAL_QUERY_KEY(businessId),
    queryFn: () => [],
    enabled: !!businessId,
    staleTime: Infinity,
  });

  const config = useQuery<AutonomyConfig | null>({
    queryKey: CONFIG_QUERY_KEY(businessId),
    queryFn: () => null,
    enabled: !!businessId,
    staleTime: Infinity,
  });

  return { journal: journal.data ?? [], config: config.data ?? null };
}
