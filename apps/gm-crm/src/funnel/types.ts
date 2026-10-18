/** Локальные типы для экрана воронки — зеркало @crm/schemas, без импорта Zod в bundle. */

export interface FunnelStage {
  id: string;
  name: string;
  normConversion: number;
  normDays: number;
  terminal: boolean;
}

export interface FunnelConfig {
  funnelId: string;
  name: string;
  stages: FunnelStage[];
}

export interface Deal {
  dealId: string;
  funnelId: string;
  currentStage: string;
  amount: number;       // kopecks
  probability: number;
  ownerId: string;
  clientId: string | null;
  expectedCloseDate: string | null;
  expectedPaymentDate: string | null;
  daysInStage: number;
  updatedAt: string;
}

export interface StageMetrics {
  stageId: string;
  stageName: string;
  terminal: boolean;
  count: number;
  factConversion: number;
  cohortConversion: number | null;
  normConversion: number;
  avgDays: number;
  normDays: number;
  stuck: string[];
  weightedPipeline: number;
}

export interface FunnelMetrics {
  funnelId: string;
  stages: StageMetrics[];
  totalWeightedPipeline: number;
}
