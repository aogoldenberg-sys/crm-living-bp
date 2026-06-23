import type { MappedSection, Gap } from "@crm/schemas";
import type { ExtractedPlan } from "./types.js";
import { REQUIRED_SECTIONS } from "./sections.js";

/**
 * Маппит сырые секции документа на эталонные 22 раздела.
 * Для каждого раздела из REQUIRED_SECTIONS:
 *   - present = ключ найден в rawSections
 *   - confidence = rawSections[key].confidence или 0
 *   - contentSummary = "" (заглушка в срезе 1, заполняет Claude в срезе 2)
 * gaps: разделы где present = false
 */
export function mapToSections(extracted: ExtractedPlan): {
  sections: MappedSection[];
  gaps: Gap[];
} {
  const sections: MappedSection[] = REQUIRED_SECTIONS.map((sectionId) => {
    const found = extracted.rawSections[sectionId];
    return {
      sectionId,
      present: found !== undefined,
      contentSummary: "",
      confidence: found?.confidence ?? 0,
    };
  });

  const gaps: Gap[] = sections
    .filter((s) => !s.present)
    .map((s) => ({
      missingSection: s.sectionId,
      whyMatters: `Раздел '${s.sectionId}' отсутствует в документе`,
    }));

  return { sections, gaps };
}
