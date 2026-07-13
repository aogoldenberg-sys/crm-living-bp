import { z } from "zod";
import { IsoDate, IsoDateTime, Inn, DataSource } from "../money.js";

const eventId = z.string().uuid();

export const ExternalSignal = z.object({
  type: z.literal("external_signal"),
  eventId,
  ts: IsoDateTime,
  source: DataSource,
  category: z.enum(["regulatory", "macro", "demand_trend", "competitor", "legal_risk"]),
  title: z.string().min(1),
  summary: z.string(),
  url: z.string().url().nullable(),
  impactHint: z.enum(["positive", "negative", "neutral", "unknown"]),
  relatedInn: Inn.nullable(),
}).strict();
export type ExternalSignal = z.infer<typeof ExternalSignal>;

export const DemandTrendPoint = z.object({
  type: z.literal("demand_trend"),
  eventId,
  ts: IsoDateTime,
  keyword: z.string().min(1),
  period: IsoDate,
  volume: z.number().int().nonnegative(),
  trendScore: z.number().min(-1).max(1),
  source: DataSource,
}).strict();
export type DemandTrendPoint = z.infer<typeof DemandTrendPoint>;

export const CounterpartyRiskSignal = z.object({
  type: z.literal("counterparty_risk"),
  eventId,
  ts: IsoDateTime,
  inn: Inn,
  checkId: z.enum(["arbitration", "solvency", "registry_status"]),
  severity: z.enum(["info", "yellow", "red"]),
  details: z.string(),
  sourceUrl: z.string().url().nullable(),
}).strict();
export type CounterpartyRiskSignal = z.infer<typeof CounterpartyRiskSignal>;
