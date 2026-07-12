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
import { INTAKE_TO_BOOK_ID } from "@crm/schemas";
import { auth } from "../firebase";

const BOOK_IDS_SET = new Set(Object.values(INTAKE_TO_BOOK_ID));

/** Возвращает true если хотя бы одна секция не в book-формате (нужна миграция). */
function needsMigration(sections: Array<{ sectionId: string }>): boolean {
  return sections.some(s => !s.sectionId || !BOOK_IDS_SET.has(s.sectionId));
}

async function triggerMigration(workerUrl: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  const idToken = await user.getIdToken();
  await fetch(`${workerUrl}/intake-migrate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
    body: "{}",
  }).catch(e => console.warn("[useIntake] migration failed:", e));
}

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

export interface SectionComment {
  issue: string;
  quote: string;
  severity: "low" | "medium" | "high";
  suggested_fix: string;
}

export interface SectionEval {
  section_key: string;
  verdict: "approved" | "flagged";
  scores: { objectivity: number; realism: number; justification: number };
  comments: SectionComment[];
}

export interface CrossIssue {
  sections: string[];
  issue: string;
}

export type GrantType = "minek" | "agrostartup" | "governor" | "minvostok" | "skolkovo" | "fondprez";

export interface GrantResult {
  grantType: GrantType;
  grantLabel: string;
  maxRub: string;
  readinessScore: number;
  missingSections: string[];
  weakSections: string[];
  adaptedSections: Record<string, string>;
  grantSummary: string;
  generatedAt: string;
}

export interface RoadmapPhase {
  phase: number;
  title: string;
  actions: string[];
  dueInDays: number;
  depends_on: number[];
  deliverable: string;
}

export interface GeneratedRoadmap {
  phases: RoadmapPhase[];
  generatedAt: string;
}

export interface HolisticAssessment {
  assessedAt: string;
  sections: SectionEval[];
  cross_section_issues: CrossIssue[];
}

export interface ClaudeReview {
  verdict: "realistic" | "needs_improvement" | "unrealistic" | "insufficient_data";
  reasoning: string;
  proposedRewrite: string | null;
  successScore: number;
  reviewedAt?: string;
  accepted?: boolean;
}

export interface MappedSection {
  sectionId: string;
  present: boolean;
  contentSummary: string;
  confidence: number;
  claudeReview?: ClaudeReview;
}

export interface PlanIntake {
  /** Firestore document id (intakeId) — нужен для /intake-refine */
  intakeId?: string;
  assessment: Assessment;
  mappedSections: MappedSection[];
  disclaimer: string;
  status: string;
  extractedAt?: string;
  narrativeReady?: boolean;
  logoUrl?: string;
  holisticAssessment?: HolisticAssessment;
  assessmentStatus?: "processing" | "done" | "error";
  assessmentError?: string;
  generatedRoadmap?: GeneratedRoadmap;
  roadmapStatus?: "processing" | "done" | "error";
  reformStatus?: "processing" | "done" | "error";
  grantAdaptations?: Record<string, GrantResult>;
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

function normalizeGeneratedRoadmap(raw: unknown): GeneratedRoadmap | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.phases)) return undefined;
  return {
    phases: r.phases as RoadmapPhase[],
    generatedAt: typeof r.generatedAt === "string" ? r.generatedAt : "",
  };
}

function normalizeHolisticAssessment(raw: unknown): HolisticAssessment | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  return {
    assessedAt: typeof r.assessedAt === "string" ? r.assessedAt : "",
    sections: Array.isArray(r.sections) ? (r.sections as SectionEval[]) : [],
    cross_section_issues: Array.isArray(r.cross_section_issues) ? (r.cross_section_issues as CrossIssue[]) : [],
  };
}

function normalizeClaudeReview(raw: unknown): ClaudeReview | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const v = r.verdict as string;
  if (!["realistic", "needs_improvement", "unrealistic", "insufficient_data"].includes(v)) return undefined;
  return {
    verdict: v as ClaudeReview["verdict"],
    reasoning: typeof r.reasoning === "string" ? r.reasoning : "",
    proposedRewrite: typeof r.proposedRewrite === "string" ? r.proposedRewrite : null,
    successScore: typeof r.successScore === "number" ? r.successScore : 0,
    reviewedAt: typeof r.reviewedAt === "string" ? r.reviewedAt : undefined,
    accepted: Boolean(r.accepted),
  };
}

function normalizeMappedSections(raw: unknown): MappedSection[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((s) => {
    if (!s || typeof s !== "object") return [];
    const obj = s as Record<string, unknown>;
    return [{
      sectionId: typeof obj.sectionId === "string" ? obj.sectionId : "",
      present: Boolean(obj.present),
      contentSummary: typeof obj.contentSummary === "string" ? obj.contentSummary : "",
      confidence: typeof obj.confidence === "number" ? obj.confidence : 0,
      claudeReview: normalizeClaudeReview(obj.claudeReview),
    }];
  });
}

function normalizeIntake(raw: Record<string, unknown>, docId?: string): PlanIntake {
  const assessment = (raw.assessment as Record<string, unknown> | undefined) ?? {};
  return {
    intakeId: typeof raw.intakeId === "string" ? raw.intakeId : (docId ?? undefined),
    mappedSections: normalizeMappedSections(raw.mappedSections),
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
    logoUrl: typeof raw.logoUrl === "string" ? raw.logoUrl : undefined,
    holisticAssessment: normalizeHolisticAssessment(raw.holisticAssessment),
    assessmentStatus: (raw.assessmentStatus as PlanIntake["assessmentStatus"]) ?? undefined,
    assessmentError: typeof raw.assessmentError === "string" ? raw.assessmentError : undefined,
    generatedRoadmap: normalizeGeneratedRoadmap(raw.generatedRoadmap),
    roadmapStatus: (raw.roadmapStatus as PlanIntake["roadmapStatus"]) ?? undefined,
    reformStatus: (raw.reformStatus as PlanIntake["reformStatus"]) ?? undefined,
    grantAdaptations: (raw.grantAdaptations && typeof raw.grantAdaptations === "object")
      ? (raw.grantAdaptations as Record<string, GrantResult>)
      : undefined,
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

    const migratedRef = { current: false };
    const workerUrl = (import.meta.env.VITE_INGEST_WORKER_URL as string) ?? "";

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        if (!snap.empty && snap.docs[0]) {
          const raw = snap.docs[0].data() as Record<string, unknown>;
          const normalized = normalizeIntake(raw, snap.docs[0].id);
          queryClient.setQueryData(QUERY_KEY(businessId), normalized);
          if (!migratedRef.current && needsMigration(normalized.mappedSections)) {
            migratedRef.current = true;
            void triggerMigration(workerUrl);
          }
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
