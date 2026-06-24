export type DataSourceId =
  | "bank_api"          // bank statement / payment import
  | "ads_api"           // advertising cabinet
  | "telephony"         // call logging
  | "crm_manual"        // manual CRM entries
  | "plan_document";    // uploaded business plan

export type ReadinessStatus = "active" | "dormant" | "unavailable";

export interface DataSourceInfo {
  id: DataSourceId;
  label: string;           // human-readable Russian name
  status: ReadinessStatus;
  /** Why it's dormant/unavailable */
  reason?: string;
  /** What the user should do to activate */
  action?: string;
}

export interface ModuleReadiness {
  moduleId: string;        // e.g. "uniteconomics", "funnel", "forecast"
  label: string;
  status: ReadinessStatus;
  /** Which data sources this module needs */
  requiredSources: DataSourceId[];
  /** Missing sources that would improve it */
  missingActive: DataSourceId[];
  reason: string;
  action?: string;
}

export interface DataReadinessReport {
  sources: DataSourceInfo[];
  modules: ModuleReadiness[];
  /** Count of active sources */
  activeCount: number;
  /** True if minimum viable data exists (at least bank_api OR crm_manual active) */
  viable: boolean;
}

export interface ConnectedSources {
  /** Set of currently connected source IDs */
  active: Set<DataSourceId>;
}

export interface PlanPresence {
  /** true if a business plan document has been uploaded */
  hasPlan: boolean;
  /** true if plan has been assessed (intake exists) */
  hasIntake: boolean;
}
