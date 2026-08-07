import type { PrimaryDocKind, FieldSpec, FieldType } from "@crm/schemas";
import type { Result } from "@crm/core";

export type { FieldSpec, FieldType };

export type DocGenerator = {
  docKind: PrimaryDocKind;
  title: string;
  requiredFields: FieldSpec[];
  compute?: (fields: Record<string, unknown>) => Result<unknown>;
  render: (fields: Record<string, unknown>, computed?: unknown) => Result<string>;
  needsLLM: boolean;
};
