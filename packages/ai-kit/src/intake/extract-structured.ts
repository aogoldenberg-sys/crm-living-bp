/**
 * extractStructured — детерминированный парсер структурированных документов.
 *
 * Применяется когда вход — структурированный markdown/CSV/Excel-дамп
 * с явными таблицами и числовыми полями. Ноль токенов, нет галлюцинаций.
 *
 * Контракт:
 *   - Денежные значения → kopecks (целые, ₽ × 100)
 *   - Проценты → number (0–100, не 0–1)
 *   - Диапазоны → AssumptionValueRange { lo, hi }
 *   - Точные значения → AssumptionValuePoint { point }
 *   - origin всегда "human" (парсер детерминирован, но это человеческий документ)
 *
 * Архитектурная роль:
 *   structured input (Excel/md-tables) → extractStructured (this function) → ExtractedPlan
 *   unstructured input (PDF/prose/voice) → extractProse (claude) → ExtractedPlan
 */

import type { ExtractedPlan } from "@crm/core";
import type { AssumptionSet, Assumption } from "@crm/schemas";
import { type Result, ok, err } from "@crm/core";

// ── Regex helpers ─────────────────────────────────────────────────────────────

/**
 * Найти первое число с опциональными разделителями тысяч из строки типа
 * "| ИТОГО CAPEX | | | **31 790 000 ₽** |"
 * → 31790000
 */
function parseRub(s: string): number | null {
  const m = s.match(/[\d\s]+(?:[.,]\d+)?/);
  if (!m) return null;
  const cleaned = m[0].replace(/\s/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

/** Найти процент "57%" → 57 */
function parsePct(s: string): number | null {
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (!m || !m[1]) return null;
  const n = parseFloat(m[1].replace(",", "."));
  return isNaN(n) ? null : n;
}

/** Найти значение из таблицы "| Ключ | **31 790 000 ₽** |" */
function tableValue(text: string, keyPattern: RegExp): string | null {
  const lines = text.split("\n");
  for (const line of lines) {
    if (keyPattern.test(line)) {
      // Extract last cell content
      const parts = line.split("|").map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        return parts[parts.length - 1] ?? null;
      }
    }
  }
  return null;
}

/** Parse "31 790 000 ₽" or "**31 790 000 ₽**" → 3179000000 kopecks */
function parseRubToKopecks(raw: string | null): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\*\*/g, "").replace(/₽/g, "").trim();
  const n = parseRub(cleaned);
  return n !== null ? Math.round(n * 100) : null;
}

function assumption(
  key: string,
  value: Assumption["value"],
  unit: string,
  confidence: number,
  sourceSection: string,
  verifiableBy: string | null,
  afterEvent: string | null,
): [string, Assumption] {
  return [
    key,
    {
      key,
      value,
      unit,
      origin: "human",
      confidence,
      sourceSection,
      verifiability: { verifiableBy, afterEvent },
    },
  ];
}

// ── Main extractor ────────────────────────────────────────────────────────────

/**
 * Детерминированный экстрактор для BUSINESS_PLAN_2026.md (и аналогичных
 * структурированных бизнес-планов с таблицами).
 *
 * Если добавляется новый тип документа — создай новую функцию extractStructuredXxx
 * и подключи к роутеру в extract.ts.
 */
export function extractStructured(
  businessId: string,
  docText: string,
): Result<ExtractedPlan> {
  try {
    const assumptions: AssumptionSet = {};

    // ── CAPEX ───────────────────────────────────────────────────────────────
    const capexRaw = tableValue(docText, /ИТОГО CAPEX/i);
    const capexKop = parseRubToKopecks(capexRaw);
    if (capexKop !== null) {
      const [k, v] = assumption(
        "capex_total",
        { point: capexKop },
        "₽",
        0.98,
        "finances",
        null,
        null,
      );
      assumptions[k] = v;
    }

    // ── Grants ──────────────────────────────────────────────────────────────
    const minekRaw = tableValue(docText, /Субсидия Минэк.*модул/i);
    const minekKop = parseRubToKopecks(minekRaw);
    if (minekKop !== null) {
      const [k, v] = assumption(
        "grant_minek",
        { point: minekKop },
        "₽",
        0.9,
        "funding_ask",
        null,
        null,
      );
      assumptions[k] = v;
    }

    const agroRaw = tableValue(docText, /Агростартап/i);
    const agroKop = parseRubToKopecks(agroRaw);
    if (agroKop !== null) {
      const [k, v] = assumption(
        "grant_agrostartup",
        { point: agroKop },
        "₽",
        0.85,
        "funding_ask",
        null,
        null,
      );
      assumptions[k] = v;
    }

    const minvostokRaw = tableValue(docText, /Единая субсидия Минвостока/i);
    const minvostokKop = parseRubToKopecks(minvostokRaw);
    if (minvostokKop !== null) {
      const [k, v] = assumption(
        "grant_minvostok",
        { point: minvostokKop },
        "₽",
        0.75,
        "funding_ask",
        null,
        null,
      );
      assumptions[k] = v;
    }

    // ── ADR ─────────────────────────────────────────────────────────────────
    // Blended ADR from "Blended ADR | 22 000 ₽"
    const adrBlendedRaw = tableValue(docText, /Blended ADR/i);
    const adrBlendedParsed = adrBlendedRaw
      ? parseRub(adrBlendedRaw.replace(/\*\*/g, "").replace(/₽/g, ""))
      : null;
    if (adrBlendedParsed !== null) {
      const [k, v] = assumption(
        "adr_blended",
        { point: Math.round(adrBlendedParsed * 100) },
        "₽",
        0.95,
        "unit_economics",
        "OTA_stats",
        "После первого полного сезона (2028)",
      );
      assumptions[k] = v;
    }

    // Peak ADR
    const adrPeakRaw = tableValue(docText, /Пик\s*\|\s*\d/i);
    const adrPeakKop = adrPeakRaw
      ? Math.round((parseRub(adrPeakRaw.replace(/₽/g, "").replace(/\*\*/g, "")) ?? 0) * 100)
      : null;
    if (adrPeakKop) {
      const [k, v] = assumption(
        "adr_peak",
        { point: adrPeakKop },
        "₽",
        0.9,
        "unit_economics",
        "OTA_stats",
        "После первого летнего сезона (2028)",
      );
      assumptions[k] = v;
    }

    // ── Occupancy ────────────────────────────────────────────────────────────
    const occAnnualRaw = tableValue(docText, /Средняя по году/i);
    const occAnnual = occAnnualRaw ? parsePct(occAnnualRaw) : null;
    if (occAnnual !== null) {
      const [k, v] = assumption(
        "occupancy_annual",
        { point: occAnnual },
        "%",
        0.9,
        "unit_economics",
        "OTA_stats",
        "После первого полного сезона (2028)",
      );
      assumptions[k] = v;
    }

    // Occupancy by season
    const occPeakLine = docText.match(/Пик.*июль.*?\|\s*(\d+)\s*%/i);
    if (occPeakLine?.[1]) {
      const [k, v] = assumption(
        "occupancy_peak",
        { point: parseInt(occPeakLine[1]) },
        "%",
        0.9,
        "unit_economics",
        "OTA_stats",
        "После первого летнего сезона (2028)",
      );
      assumptions[k] = v;
    }

    const occShoulderLine = docText.match(/Плечо.*?(\d+)\s*%/i);
    if (occShoulderLine?.[1]) {
      const [k, v] = assumption(
        "occupancy_shoulder",
        { point: parseInt(occShoulderLine[1]) },
        "%",
        0.85,
        "unit_economics",
        "OTA_stats",
        "После первого плечевого сезона (2028)",
      );
      assumptions[k] = v;
    }

    const occWinterLine = docText.match(/Зима.*ноябр.*?(\d+)\s*%/i);
    if (occWinterLine?.[1]) {
      const [k, v] = assumption(
        "occupancy_winter",
        { point: parseInt(occWinterLine[1]) },
        "%",
        0.8,
        "unit_economics",
        "OTA_stats",
        "После первого зимнего сезона (2028–2029)",
      );
      assumptions[k] = v;
    }

    // ── Revenue ──────────────────────────────────────────────────────────────
    const rev1Match = docText.match(/Выручка год 1[^|]*?\~?\s*([\d\s]+(?:,\d+)?)\s*₽/i);
    if (rev1Match?.[1]) {
      const rub = parseRub(rev1Match[1]);
      if (rub) {
        const [k, v] = assumption(
          "revenue_year1",
          { point: Math.round(rub * 100) },
          "₽",
          0.85,
          "finances",
          "accounting",
          "По итогам 2027 года (частичный сезон)",
        );
        assumptions[k] = v;
      }
    }

    // Revenue year 2 base from P&L table
    // "| **Выручка ИТОГО** | **31 800 000** | **58 200 000** | **71 500 000** | |"
    // Capture pessimism | base | optimism columns (bold, space-separated numbers)
    const rev2Match = docText.match(
      /\*\*Выручка\s*ИТОГО\*\*[^|]*\|\s*\*\*([\d\s]+)\*\*[^|]*\|\s*\*\*([\d\s]+)\*\*[^|]*\|\s*\*\*([\d\s]+)\*\*/,
    );
    if (rev2Match?.[2]) {
      const base = parseRub(rev2Match[2]);
      if (base) {
        const [k, v] = assumption(
          "revenue_year2_base",
          { point: Math.round(base * 100) },
          "₽",
          0.85,
          "finances",
          "accounting",
          "По итогам 2028 года (первый полный сезон)",
        );
        assumptions[k] = v;
      }
    }

    // Revenue year 3 from "Трёхлетний прогноз | 2029 | 68 000 000"
    const rev3Line = docText.match(/2029\s*\|\s*([\d\s]+)\s*\|/);
    if (rev3Line?.[1]) {
      const rub = parseRub(rev3Line[1]);
      if (rub) {
        const [k, v] = assumption(
          "revenue_year3",
          { point: Math.round(rub * 100) },
          "₽",
          0.8,
          "finances",
          "accounting",
          "По итогам 2029 года",
        );
        assumptions[k] = v;
      }
    }

    // ── EBITDA ───────────────────────────────────────────────────────────────
    // "| **EBITDA** | **11 380 000** | **32 920 000** | **42 175 000** | |"
    const ebitdaMatch = docText.match(
      /\*\*EBITDA\*\*[^|]*\|\s*\*\*([\d\s]+)\*\*[^|]*\|\s*\*\*([\d\s]+)\*\*[^|]*\|\s*\*\*([\d\s]+)\*\*/,
    );
    if (ebitdaMatch?.[2]) {
      const rub = parseRub(ebitdaMatch[2]);
      if (rub) {
        const [k, v] = assumption(
          "ebitda_year2_base",
          { point: Math.round(rub * 100) },
          "₽",
          0.85,
          "finances",
          "accounting",
          "По итогам 2028 года",
        );
        assumptions[k] = v;
      }
    }

    // EBITDA margin "| **EBITDA-маржа** | **36%** | **57%** | **59%** |"
    const ebitdaMarginMatch = docText.match(
      /\*\*EBITDA-маржа\*\*[^|]*\|\s*\*\*(\d+)%\*\*[^|]*\|\s*\*\*(\d+)%\*\*/,
    );
    if (ebitdaMarginMatch?.[2]) {
      const [k, v] = assumption(
        "ebitda_margin_base",
        { point: parseInt(ebitdaMarginMatch[2]) },
        "%",
        0.9,
        "unit_economics",
        "accounting",
        "По итогам 2028 года",
      );
      assumptions[k] = v;
    }

    // ── Other ────────────────────────────────────────────────────────────────
    // Modules count
    const modulesMatch = docText.match(/(\d+)\s*модул/i);
    if (modulesMatch?.[1] && parseInt(modulesMatch[1]) >= 5 && parseInt(modulesMatch[1]) <= 50) {
      const [k, v] = assumption(
        "modules_count",
        { point: parseInt(modulesMatch[1]) },
        "шт",
        0.99,
        "business_model",
        null,
        null,
      );
      assumptions[k] = v;
    }

    // Trip check — range from audience section "150–250 тыс ₽ (перелёт + размещение + туры)"
    const tripCheckMatch = docText.match(/Средний чек поездки.*?(\d+)[–-](\d+)\s*тыс\s*₽/i);
    if (tripCheckMatch?.[1] && tripCheckMatch?.[2]) {
      const lo = parseInt(tripCheckMatch[1]) * 1000 * 100; // тыс ₽ → kopecks
      const hi = parseInt(tripCheckMatch[2]) * 1000 * 100;
      const [k, v] = assumption(
        "trip_check",
        { lo, hi },
        "₽",
        0.8,
        "unit_economics",
        "accounting",
        "После первого полного сезона (2028)",
      );
      assumptions[k] = v;
    }

    // BEP occupancy "Загрузка BEP | ~23%"
    const bepLine = tableValue(docText, /Загрузка BEP/i);
    const bepPct = bepLine ? parsePct(bepLine) : null;
    if (bepPct !== null) {
      const [k, v] = assumption(
        "bep_occupancy",
        { point: bepPct },
        "%",
        0.95,
        "finances",
        "accounting",
        "По итогам 2028 года",
      );
      assumptions[k] = v;
    }

    // Payback months — use exec-summary range "18–24 месяца" (more meaningful than per-season calc)
    const paybackMatch = docText.match(/Срок окупаемости.*?(\d+)[–-](\d+)\s*месяц/i);
    if (paybackMatch?.[1] && paybackMatch?.[2]) {
      const [k, v] = assumption(
        "payback_months",
        { lo: parseInt(paybackMatch[1]), hi: parseInt(paybackMatch[2]) },
        "мес",
        0.85,
        "finances",
        "accounting",
        "По итогам 2028–2029 года",
      );
      assumptions[k] = v;
    }

    // CAC "| CAC = 2 000 000 / 200 | **10 000 ₽** |"
    const cacMatch = docText.match(/CAC\s*=\s*[\d\s]+\/\s*\d+\s*\|\s*\*\*([\d\s]+)\s*₽\*\*/i);
    if (cacMatch?.[1]) {
      const rub = parseRub(cacMatch[1]);
      if (rub) {
        const [k, v] = assumption(
          "cac",
          { point: Math.round(rub * 100) },
          "₽",
          0.85,
          "marketing_strategy",
          "accounting",
          "После первого полного сезона (2028)",
        );
        assumptions[k] = v;
      }
    }

    // ── Section presence ─────────────────────────────────────────────────────
    const rawSections: Record<string, { text: string; confidence: number }> = {};

    const sectionMap: Array<[string, RegExp, number]> = [
      ["executive_summary", /РАЗДЕЛ 1|EXECUTIVE SUMMARY|Суть проекта/i, 0.95],
      ["market_size", /РАЗДЕЛ 2|анализ рынка|PESTLE/i, 0.9],
      ["target_audience", /целевая аудитория|персона|ПОРТРЕТ/i, 0.9],
      ["value_proposition", /ценностное предложение|УТП|VPC/i, 0.85],
      ["competitors", /конкурент|3C Framework/i, 0.85],
      ["business_model", /бизнес-модел|BMC|Delta Model/i, 0.9],
      ["pricing", /ADR|ценообразование|цена\/ночь/i, 0.95],
      ["product_roadmap", /ROADMAP|фазы|монтаж модулей|РАЗДЕЛ.*3|РАЗДЕЛ.*4/i, 0.85],
      ["sales_channels", /Яндекс Путешествия|Островок|Instagram|OTA/i, 0.8],
      ["marketing_strategy", /маркетинговый бюджет|CAC|РАЗДЕЛ.*7/i, 0.85],
      ["team", /Граненова|Барляева|КФХ|команда/i, 0.8],
      ["operations", /операци|персонал|ФОТ|РАЗДЕЛ.*7/i, 0.85],
      ["finances", /РАЗДЕЛ 8|P&L|EBITDA|CAPEX/i, 0.95],
      ["unit_economics", /Unit Economics|RevPAR|LTV\/CAC/i, 0.95],
      ["risks", /РАЗДЕЛ 10|риски и митигация/i, 0.9],
      ["legal", /РАЗДЕЛ 9|юридическ|ТОР|ООО.*Wood/i, 0.9],
      ["funding_ask", /грантовый план|субсидия|финансирование/i, 0.95],
    ];

    for (const [sectionId, pattern, confidence] of sectionMap) {
      if (pattern.test(docText)) {
        // Extract first match context (50 chars)
        const m = docText.match(pattern);
        const idx = m ? docText.indexOf(m[0]) : 0;
        rawSections[sectionId] = {
          text: docText.slice(idx, idx + 80).replace(/\n/g, " ").trim(),
          confidence,
        };
      }
    }

    if (Object.keys(assumptions).length === 0) {
      return err({
        code: "STORAGE_ERROR",
        message: "extractStructured: ноль гипотез извлечено. Документ не соответствует ожидаемому формату.",
      });
    }

    return ok({
      businessId,
      rawSections,
      assumptions,
    });
  } catch (e) {
    return err({
      code: "STORAGE_ERROR",
      message: `extractStructured: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}
