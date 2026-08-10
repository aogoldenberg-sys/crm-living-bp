/**
 * Парсер Excel (xlsx/xls) → страницы по листам.
 * Каждый лист = отдельная "страница" для маппинга.
 *
 * Используется xlsx-парсер (уже установлен в воркере).
 * Работает в CF Workers (без Node.js fs).
 */

// РЕШЕНИЕ: используем globalThis.XLSX — CF Workers не поддерживают top-level await import,
// а xlsx пакет бандлится воркером отдельно и доступен глобально.

// Минимальный тип поверхности XLSX, которую мы реально вызываем.
interface XLSXStatic {
  read(data: ArrayBuffer, opts: { type: string }): { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: { sheet_to_csv(sheet: unknown): string };
}

export function parseExcelToPages(
  buffer: ArrayBuffer,
): Array<{ pageNum: number; text: string }> {
  try {
    const XLSX = (globalThis as typeof globalThis & { XLSX?: XLSXStatic }).XLSX;
    if (!XLSX) return [{ pageNum: 1, text: "Excel файл (парсер недоступен)" }];

    const workbook = XLSX.read(buffer, { type: "array" });
    const pages: Array<{ pageNum: number; text: string }> = [];

    workbook.SheetNames.forEach((sheetName: string, idx: number) => {
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      // Имя листа как заголовок — rule-mapper сможет матчить по нему
      pages.push({
        pageNum: idx + 1,
        text: `Лист: ${sheetName}\n${csv}`,
      });
    });

    return pages;
  } catch {
    return [{ pageNum: 1, text: "Ошибка парсинга Excel" }];
  }
}
