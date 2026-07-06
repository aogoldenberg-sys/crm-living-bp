import { useState } from "react";
import type { ComplianceCase } from "@crm/schemas";
import { UploadStep } from "./UploadStep";
import { ExtractingProgress } from "./ExtractingProgress";
import { ChecklistStep } from "./ChecklistStep";
import { PackageStep } from "./PackageStep";
import { DoneView } from "./DoneView";

interface Props {
  businessId: string;
}

export function ComplianceFlow({ businessId: _businessId }: Props) {
  const [caseData, setCaseData] = useState<ComplianceCase | null>(null);

  if (!caseData) {
    return <UploadStep onComplete={setCaseData} />;
  }

  switch (caseData.status) {
    case "extracting":
      return <ExtractingProgress />;
    case "checklist_review":
      return <ChecklistStep caseData={caseData} onChange={setCaseData} />;
    case "assembling":
    case "response_draft":
      return <PackageStep caseData={caseData} onChange={setCaseData} />;
    case "done":
      return <DoneView caseData={caseData} />;
    default:
      return null;
  }
}
