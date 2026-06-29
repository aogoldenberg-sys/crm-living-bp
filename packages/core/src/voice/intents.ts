import type { VoiceExtractResult } from "@crm/schemas";

// Pure: VoiceExtractResult → domain events/patches
// Return null if needsClarification or confidence < 0.8 — do not apply silently

export type DealPatch = {
  type: "deal_patch";
  dealId: string;
  amount?: number;
  paymentDelay?: number;
  stage?: string;
};

export type ExpenseEvent = {
  type: "expense_event";
  category: string;
  amount: number;
  date?: string;
  description?: string;
};

export type MarketNode = {
  type: "market_node";
  text: string;
  source?: string;
  sector?: string;
};

export type PlanAdjustment = {
  type: "plan_adjustment";
  milestoneId?: string;
  description: string;
  targetDate?: string;
  requiresConfirmation: true; // always true per §15
};

export type VoiceAction = DealPatch | ExpenseEvent | MarketNode | PlanAdjustment;

export function mapIntentToAction(result: VoiceExtractResult): VoiceAction | null {
  if (result.needsClarification || result.confidence < 0.8) return null;

  switch (result.intent) {
    case "update_deal": {
      const d = result.diff as {
        dealId: string;
        amount?: number;
        paymentDelay?: number;
        stage?: string;
      };
      const patch: DealPatch = { type: "deal_patch", dealId: d.dealId };
      if (d.amount !== undefined) patch.amount = d.amount;
      if (d.paymentDelay !== undefined) patch.paymentDelay = d.paymentDelay;
      if (d.stage !== undefined) patch.stage = d.stage;
      return patch;
    }
    case "add_expense": {
      const d = result.diff as {
        category: string;
        amount: number;
        date?: string;
        description?: string;
      };
      const event: ExpenseEvent = { type: "expense_event", category: d.category, amount: d.amount };
      if (d.date !== undefined) event.date = d.date;
      if (d.description !== undefined) event.description = d.description;
      return event;
    }
    case "market_insight": {
      const d = result.diff as { text: string; source?: string; sector?: string };
      const node: MarketNode = { type: "market_node", text: d.text };
      if (d.source !== undefined) node.source = d.source;
      if (d.sector !== undefined) node.sector = d.sector;
      return node;
    }
    case "adjust_plan": {
      const d = result.diff as {
        milestoneId?: string;
        description: string;
        targetDate?: string;
      };
      const adjustment: PlanAdjustment = {
        type: "plan_adjustment",
        description: d.description,
        requiresConfirmation: true,
      };
      if (d.milestoneId !== undefined) adjustment.milestoneId = d.milestoneId;
      if (d.targetDate !== undefined) adjustment.targetDate = d.targetDate;
      return adjustment;
    }
  }
}
