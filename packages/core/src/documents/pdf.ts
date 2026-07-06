import PDFDocument from "pdfkit";
import type { KndPayment, KndUsnIncome } from "@crm/schemas";

/**
 * PDF через pdfkit без кастомных шрифтов.
 * Кириллица не поддерживается встроенными шрифтами pdfkit,
 * поэтому заголовки — транслитерация, значения — как есть (цифры/латиница).
 * Для MVP достаточно, позже заменить на шрифт с Unicode.
 */

/** Собирает PDF в Buffer через stream. */
function buildPdf(draw: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    draw(doc);
    doc.end();
  });
}

/** Рисует заголовок секции. */
function header(doc: PDFKit.PDFDocument, title: string): void {
  doc.fontSize(14).font("Helvetica-Bold").text(title, { underline: false });
  doc.moveDown(0.3);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
  doc.moveDown(0.5);
}

/** Рисует строку таблицы key: value. */
function row(doc: PDFKit.PDFDocument, label: string, value: string): void {
  doc.fontSize(10).font("Helvetica-Bold").text(label + ":", { continued: true, width: 220 });
  doc.font("Helvetica").text("  " + value);
}

/** Форматирует копейки в рубли: 150000 → "1 500.00 RUB". */
function formatKopecks(kopecks: number): string {
  const rubles = (kopecks / 100).toFixed(2);
  return rubles.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " RUB";
}

/**
 * Генерирует PDF-квитанцию платёжного поручения (КНД 1161101).
 */
export async function generatePaymentPdf(payment: KndPayment): Promise<Buffer> {
  return buildPdf((doc) => {
    header(doc, "PAYMENT ORDER / Platezhnoe poruchenie");
    row(doc, "KND",         payment.КНД);
    row(doc, "Date",        payment.ДатаДок);
    row(doc, "Doc No",      payment.НомерДок);
    row(doc, "INN Payer",   payment.ИННПлат);
    row(doc, "INN Receiver",payment.ИННПолуч);
    row(doc, "Amount",      formatKopecks(payment.Сумма));
    if (payment.ИННЮЛ) row(doc, "INN YUL", payment.ИННЮЛ);
    if (payment.КПП)   row(doc, "KPP",     payment.КПП);

    doc.moveDown(1);
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor("gray")
      .text("Generated: " + new Date().toISOString());
  });
}

/**
 * Генерирует PDF-сводку УСН декларации (КНД 1152017).
 */
export async function generateUsnSummaryPdf(usn: KndUsnIncome): Promise<Buffer> {
  return buildPdf((doc) => {
    header(doc, "USN DECLARATION SUMMARY / Deklaratsiya USN");
    row(doc, "KND",          usn.КНД);
    row(doc, "Date",         usn.ДатаДок);
    row(doc, "Income (Doh)", formatKopecks(usn.ДохНалПер));
    row(doc, "Tax base",     formatKopecks(usn.НалБаза));
    row(doc, "Tax (SumNal)", formatKopecks(usn.СумНал));
    if (usn.ИННЮЛ) row(doc, "INN YUL", usn.ИННЮЛ);
    if (usn.КПП)   row(doc, "KPP",     usn.КПП);

    doc.moveDown(1);
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor("gray")
      .text("Generated: " + new Date().toISOString());
  });
}
