import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
} from "firebase/firestore";
import { db } from "../firebase";

export interface Concern {
  description: string;
  severity: "red" | "yellow";
  rationale?: string;
}

export interface Gap {
  missingSection: string;
  description?: string;
}

export interface AssumptionEntry {
  key: string;
  value: { point?: number; lo?: number; hi?: number };
  unit: string;
}

export interface Assessment {
  strengths: string[];
  concerns: Concern[];
  gaps: Gap[];
  assumptionsExtracted: Record<string, AssumptionEntry>;
}

export interface PlanIntake {
  assessment: Assessment;
  disclaimer: string;
  status: string;
  extractedAt?: string;
  /** true если Claude-нарратив уже добавлен, false/undefined если ещё TODO */
  narrativeReady?: boolean;
}

const QUERY_KEY = (businessId: string) => ["intake", businessId];

// ── Нормализаторы: Firestore raw → типизированные объекты ──────────────────

function normalizeConcerns(raw: unknown): Concern[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c) => {
    if (typeof c === "string") {
      // extractStructured пишет строки; severity по умолчанию yellow
      return { description: c, severity: "yellow" as const };
    }
    if (typeof c === "object" && c !== null && "description" in c) {
      return {
        description: String((c as { description: unknown }).description),
        severity: ((c as { severity?: unknown }).severity === "red" ? "red" : "yellow") as
          | "red"
          | "yellow",
        rationale: (c as { rationale?: string }).rationale,
      };
    }
    return { description: String(c), severity: "yellow" as const };
  });
}

function normalizeGaps(raw: unknown): Gap[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((g) => {
    if (typeof g === "string") return { missingSection: g };
    if (typeof g === "object" && g !== null && "missingSection" in g) {
      return {
        missingSection: String((g as { missingSection: unknown }).missingSection),
        description: (g as { description?: string }).description,
      };
    }
    return { missingSection: String(g) };
  });
}

function normalizeAssumptions(raw: unknown): Record<string, AssumptionEntry> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, AssumptionEntry> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== "object") continue;
    const entry = val as Record<string, unknown>;
    const value = entry.value as Record<string, unknown> | undefined;
    if (!value) continue;
    result[key] = {
      key,
      value: {
        point: typeof value.point === "number" ? value.point : undefined,
        lo: typeof value.lo === "number" ? value.lo : undefined,
        hi: typeof value.hi === "number" ? value.hi : undefined,
      },
      unit: typeof entry.unit === "string" ? entry.unit : "",
    };
  }
  return result;
}

function normalizeIntake(raw: Record<string, unknown>): PlanIntake {
  const assessment = (raw.assessment as Record<string, unknown> | undefined) ?? {};
  return {
    assessment: {
      strengths: Array.isArray(assessment.strengths)
        ? (assessment.strengths as unknown[]).map(String)
        : [],
      concerns: normalizeConcerns(assessment.concerns),
      gaps: normalizeGaps(assessment.gaps),
      assumptionsExtracted: normalizeAssumptions(assessment.assumptionsExtracted),
    },
    disclaimer: typeof raw.disclaimer === "string" ? raw.disclaimer : "",
    status: typeof raw.status === "string" ? raw.status : "draft",
    extractedAt: typeof raw.extractedAt === "string" ? raw.extractedAt : undefined,
    narrativeReady: Boolean((assessment as Record<string, unknown>).narrativeReady),
  };
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useIntake(businessId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!businessId) return;

    // Исправлено: plan_intakes (множественное число) — именно такое имя коллекции
    const colRef = collection(db, `tenants/${businessId}/plan_intakes`);
    const q = query(colRef, orderBy("extractedAt", "desc"), limit(1));

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        if (!snap.empty && snap.docs[0]) {
          const raw = snap.docs[0].data() as Record<string, unknown>;
          queryClient.setQueryData(QUERY_KEY(businessId), normalizeIntake(raw));
        } else {
          queryClient.setQueryData(QUERY_KEY(businessId), null);
        }
      },
      (error) => {
        console.error("useIntake onSnapshot error:", error);
      },
    );

    return () => unsubscribe();
  }, [businessId, queryClient]);

  return useQuery<PlanIntake | null>({
    queryKey: QUERY_KEY(businessId),
    queryFn: () => null,
    enabled: !!businessId,
    staleTime: Infinity,
  });
}
