import type { PrimaryDocKind } from "@crm/schemas";

export type Requisites = {
  companyName: string;
  companyInn: string;
  address?: string;
  ogrn?: string;
};

export interface CaseDataSource {
  getRequisites(): Requisites | null;
  resolveDocument(kind: PrimaryDocKind): "found" | "not_found";
}

/** Режим A: автономный, реквизиты переданы явно. */
export function standaloneSource(requisites: Requisites): CaseDataSource {
  return {
    getRequisites: () => requisites,
    resolveDocument: () => "not_found",
  };
}
