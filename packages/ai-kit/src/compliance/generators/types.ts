import type { PrimaryDocKind } from "@crm/schemas";
import type { Result } from "@crm/core";

export type FieldType = "text" | "date" | "money" | "number";

export type FieldSpec = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
};

export type DocGenerator = {
  docKind: PrimaryDocKind;
  title: string;
  requiredFields: FieldSpec[];
  compute?: (fields: Record<string, unknown>) => Result<unknown>;
  render: (fields: Record<string, unknown>, computed?: unknown) => Result<string>;
  needsLLM: boolean;
};
