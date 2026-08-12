import { useRef } from "react";

interface Props {
  onFile: (file: File) => void;
  onBack: () => void;
  error: string | null;
}

const AUTHORITIES = [
  "ФНС", "МВД", "Прокуратура", "ФССП", "Банк (115-ФЗ)", "ГИТ", "Суд", "Контрагент",
];

const STEPS = [
  { num: "1", title: "Загрузите документ", text: "Скан, фото или PDF требования от органа. Поддерживаются PDF, JPEG, PNG, TXT." },
  { num: "2", title: "Kairos анализирует", text: "Автоматически определяет орган, тип документа и применимые правовые нормы. Занимает 30–60 секунд." },
  { num: "3", title: "Получите анализ", text: "Суть документа, правовое основание, когда мера незаконна, последствия, конкретные действия со сроками." },
  { num: "4", title: "Уточните детали", text: "Ответьте на вопросы — получите точную правовую позицию. Прикрепите дополнительные документы по делу." },
  { num: "5", title: "Скачайте документы", text: "Ходатайства, жалобы, пояснительные записки — в форматах TXT и DOC (Word), готовые к редактуре." },
];

const TODAY = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

// Общий стиль страницы-документа
const DOC_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Times+New+Roman&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Times New Roman", Times, serif; font-size: 12pt; color: #111;
    background: #fff; padding: 2cm 2.5cm; line-height: 1.6; }
  .letterhead { display: flex; justify-content: space-between; align-items: flex-start;
    border-bottom: 2px solid #1A1814; padding-bottom: 16px; margin-bottom: 24px; }
  .letterhead-left { display: flex; flex-direction: column; gap: 2px; }
  .company-name { font-size: 14pt; font-weight: bold; letter-spacing: 0.02em; }
  .company-sub { font-size: 10pt; color: #555; }
  .letterhead-right { text-align: right; font-size: 10pt; color: #555; }
  h1 { font-size: 16pt; font-weight: bold; text-align: center; margin: 24px 0 8px; text-transform: uppercase; letter-spacing: 0.04em; }
  .doc-subtitle { text-align: center; font-size: 11pt; color: #555; margin-bottom: 32px; }
  h2 { font-size: 13pt; font-weight: bold; margin: 24px 0 10px; text-transform: uppercase; letter-spacing: 0.03em; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  h3 { font-size: 12pt; font-weight: bold; margin: 16px 0 6px; }
  p, li { font-size: 12pt; margin-bottom: 8px; text-indent: 1.25cm; }
  li { text-indent: 0; margin-left: 1.25cm; }
  ol, ul { margin-bottom: 12px; }
  .step { display: flex; gap: 16px; margin-bottom: 14px; align-items: flex-start; }
  .step-num { font-size: 14pt; font-weight: bold; min-width: 24px; color: #1A1814; }
  .step-body { flex: 1; }
  .step-title { font-weight: bold; }
  .step-text { color: #444; text-indent: 0 !important; }
  .tag-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
  .tag { border: 1px solid #aaa; border-radius: 4px; padding: 2px 8px; font-size: 10pt; }
  .sign-block { margin-top: 48px; display: flex; justify-content: space-between; }
  .sign-left, .sign-right { font-size: 11pt; }
  .sign-line { border-top: 1px solid #333; width: 180px; margin-top: 32px; padding-top: 4px; font-size: 10pt; color: #555; }
  footer { margin-top: 40px; border-top: 1px solid #ccc; padding-top: 10px; font-size: 9pt; color: #888; text-align: center; }
  @media print {
    body { padding: 0; }
    @page { margin: 2cm 2.5cm; size: A4 portrait; }
    a { color: inherit; text-decoration: none; }
  }
`;

function openDocPage(html: string) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function buildInstructionHtml(): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><title>Инструкция пользователя — Kairos Compliance</title>
<style>${DOC_STYLES}</style></head>
<body>
<div class="letterhead">
  <div class="letterhead-left">
    <span class="company-name">ООО «ОпенТрейдГрупп»</span>
    <span class="company-sub">ИНН 9703235411 &nbsp;|&nbsp; ОГРН 1257700589992</span>
    <span class="company-sub">Москва-Сити, 1-й Красногвардейский пр-д, д.15</span>
    <span class="company-sub">opentgp.ru &nbsp;|&nbsp; kairos.opentgp.ru</span>
  </div>
  <div class="letterhead-right">
    <span>Дата: ${TODAY}</span><br>
    <span>Версия: 1.0</span>
  </div>
</div>

<h1>Инструкция пользователя</h1>
<p class="doc-subtitle">Kairos Compliance — сервис юридического анализа требований контролирующих органов</p>

<h2>1. Назначение сервиса</h2>
<p>Kairos Compliance предназначен для анализа официальных требований, запросов, предупреждений и иных актов контролирующих органов. Сервис автоматически определяет орган-отправитель, тип документа, применимые нормы права и формирует правовую позицию, а также готовит проекты ответных документов.</p>

<h2>2. Поддерживаемые органы</h2>
<div class="tag-row">
  <span class="tag">ФНС (камеральная)</span>
  <span class="tag">ФНС (выездная)</span>
  <span class="tag">ФНС (встречная)</span>
  <span class="tag">МВД / Полиция</span>
  <span class="tag">Прокуратура</span>
  <span class="tag">ФССП / Приставы</span>
  <span class="tag">Банк (115-ФЗ)</span>
  <span class="tag">ГИТ</span>
  <span class="tag">Суд</span>
  <span class="tag">Контрагент</span>
</div>

<h2>3. Порядок работы</h2>
<div class="step"><span class="step-num">1.</span><div class="step-body">
  <span class="step-title">Загрузка документа.</span>
  <span class="step-text"> Загрузите скан, фото или PDF-файл требования от контролирующего органа. Поддерживаемые форматы: PDF, JPEG, PNG, TXT. Максимальный размер файла определяется техническими ограничениями тарифного плана.</span>
</div></div>
<div class="step"><span class="step-num">2.</span><div class="step-body">
  <span class="step-title">Автоматический анализ.</span>
  <span class="step-text"> Система автоматически идентифицирует орган-отправитель, тип документа, правовое основание и период применимости. Анализ занимает 30–90 секунд.</span>
</div></div>
<div class="step"><span class="step-num">3.</span><div class="step-body">
  <span class="step-title">Получение первичного анализа.</span>
  <span class="step-text"> По результатам анализа формируются: суть документа, правовое основание, ситуации когда мера неприменима, последствия, конкретные действия со сроками.</span>
</div></div>
<div class="step"><span class="step-num">4.</span><div class="step-body">
  <span class="step-title">Уточнение деталей (по желанию).</span>
  <span class="step-text"> Система задаёт уточняющие вопросы, ответы на которые позволяют сформировать точную правовую позицию. Можно прикреплять дополнительные документы по делу (договоры, акты, выписки).</span>
</div></div>
<div class="step"><span class="step-num">5.</span><div class="step-body">
  <span class="step-title">Получение и скачивание документов.</span>
  <span class="step-text"> Система формирует проекты ответных документов: ходатайства, жалобы, пояснительные записки, возражения. Доступны для скачивания в форматах TXT и DOC (Microsoft Word) для последующей редакции и подписания.</span>
</div></div>

<h2>4. История кейсов</h2>
<p>Все обработанные документы сохраняются в разделе «Мои кейсы» и доступны пользователю в любое время. Кейс можно открыть повторно для продолжения работы.</p>

<h2>5. Ограничения</h2>
<ul>
  <li>Kairos предоставляет <strong>информационный анализ</strong>, а не юридическую консультацию в смысле ФЗ «Об адвокатской деятельности».</li>
  <li>Для принятия окончательных процессуальных решений рекомендуется консультация квалифицированного юриста или адвоката.</li>
  <li>Сгенерированные документы являются <strong>проектами</strong> и подлежат проверке и подписанию уполномоченным лицом организации.</li>
</ul>

<div class="sign-block">
  <div class="sign-left">
    <p style="text-indent:0">ООО «ОпенТрейдГрупп»</p>
    <div class="sign-line">Генеральный директор Морозова М.И.</div>
  </div>
  <div class="sign-right">
    <p style="text-indent:0">${TODAY}</p>
  </div>
</div>

<footer>ООО «ОпенТрейдГрупп» · ИНН 9703235411 · ОГРН 1257700589992 · Москва-Сити, 1-й Красногвардейский пр-д, д.15 · opentgp.ru</footer>
</body></html>`;
}

function buildPrivacyHtml(): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><title>Политика конфиденциальности — Kairos Compliance</title>
<style>${DOC_STYLES}</style></head>
<body>
<div class="letterhead">
  <div class="letterhead-left">
    <span class="company-name">ООО «ОпенТрейдГрупп»</span>
    <span class="company-sub">ИНН 9703235411 &nbsp;|&nbsp; ОГРН 1257700589992</span>
    <span class="company-sub">Москва-Сити, 1-й Красногвардейский пр-д, д.15</span>
    <span class="company-sub">opentgp.ru &nbsp;|&nbsp; kairos.opentgp.ru</span>
  </div>
  <div class="letterhead-right">
    <span>Дата: ${TODAY}</span><br>
    <span>Версия: 1.0</span>
  </div>
</div>

<h1>Политика конфиденциальности</h1>
<p class="doc-subtitle">Kairos Compliance — сервис ООО «ОпенТрейдГрупп»</p>

<h2>1. Общие положения</h2>
<p>Настоящая Политика конфиденциальности (далее — «Политика») регулирует порядок обработки и защиты персональных данных и документов пользователей сервиса Kairos Compliance, предоставляемого ООО «ОпенТрейдГрупп» (далее — «Оператор»).</p>
<p>Политика разработана в соответствии с Федеральным законом от 27.07.2006 № 152-ФЗ «О персональных данных» и иными применимыми нормативными актами Российской Федерации.</p>

<h2>2. Оператор</h2>
<ul>
  <li><strong>Наименование:</strong> ООО «ОпенТрейдГрупп»</li>
  <li><strong>ИНН:</strong> 9703235411 | <strong>ОГРН:</strong> 1257700589992</li>
  <li><strong>Адрес:</strong> г. Москва, 1-й Красногвардейский пр-д, д.15 (Москва-Сити)</li>
  <li><strong>Генеральный директор:</strong> Морозова М.И.</li>
  <li><strong>Сайт:</strong> opentgp.ru</li>
</ul>

<h2>3. Состав обрабатываемых данных</h2>
<p>В рамках сервиса Kairos Compliance Оператор обрабатывает следующие данные:</p>
<ul>
  <li>загруженные пользователем документы (PDF-файлы, изображения);</li>
  <li>текст, извлечённый из загруженных документов;</li>
  <li>данные об истории кейсов (орган-отправитель, дата создания, статус);</li>
  <li>аутентификационные данные, необходимые для идентификации пользователя (управляются Firebase Authentication, Google LLC).</li>
</ul>

<h2>4. Принципы доступа к данным</h2>
<p>Все загруженные документы и созданные кейсы хранятся исключительно в личном аккаунте пользователя. <strong>Доступ к данным конкретного пользователя имеет исключительно этот пользователь.</strong> Сотрудники ООО «ОпенТрейдГрупп» не имеют технического доступа к содержимому кейсов и загруженным документам пользователей.</p>
<p>Данные не передаются, не продаются и не предоставляются третьим лицам, за исключением случаев, прямо предусмотренных законодательством РФ.</p>

<h2>5. Хранение и техническая защита</h2>
<p>Данные хранятся в облачной инфраструктуре Google Firebase (Cloud Firestore, Firebase Storage), расположенной в дата-центрах Google LLC. Применяются следующие меры защиты:</p>
<ul>
  <li>шифрование данных при передаче: протокол TLS 1.3;</li>
  <li>шифрование данных при хранении: AES-256;</li>
  <li>инфраструктура Google Cloud сертифицирована по стандартам ISO/IEC 27001, SOC 2 Type II.</li>
</ul>
<p>При обработке текста документов используется API Anthropic (Claude). Данные, передаваемые в API, обрабатываются в соответствии с политикой конфиденциальности Anthropic PBC и не используются для обучения моделей (API-режим).</p>

<h2>6. Права пользователя</h2>
<p>Пользователь имеет право:</p>
<ul>
  <li>получить сведения об обрабатываемых данных в любое время;</li>
  <li>удалить любой кейс и связанные с ним данные самостоятельно в интерфейсе сервиса;</li>
  <li>потребовать полного удаления данных, направив запрос на электронный адрес Оператора.</li>
</ul>

<h2>7. Ограничение ответственности</h2>
<p>Сервис Kairos Compliance предоставляет информационно-аналитические материалы. Сформированные документы и правовые позиции <strong>не являются юридической консультацией</strong> в смысле Федерального закона «Об адвокатской деятельности и адвокатуре в Российской Федерации». Оператор не несёт ответственности за последствия принятых пользователем решений на основе материалов сервиса.</p>

<h2>8. Изменения Политики</h2>
<p>Оператор вправе вносить изменения в настоящую Политику. Актуальная версия публикуется на сайте opentgp.ru. Продолжение использования сервиса после публикации изменений означает согласие с ними.</p>

<div class="sign-block">
  <div class="sign-left">
    <p style="text-indent:0">ООО «ОпенТрейдГрупп»</p>
    <div class="sign-line">Генеральный директор Морозова М.И.</div>
  </div>
  <div class="sign-right">
    <p style="text-indent:0">${TODAY}</p>
  </div>
</div>

<footer>ООО «ОпенТрейдГрупп» · ИНН 9703235411 · ОГРН 1257700589992 · Москва-Сити, 1-й Красногвардейский пр-д, д.15 · opentgp.ru</footer>
</body></html>`;
}

export function ComplianceUploadLanding({ onFile, onBack, error }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  }

  return (
    <div className="crm-cl-wrap">

      <button type="button" className="crm-v2-btn-secondary crm-cl-back" onClick={onBack}>
        ← К списку кейсов
      </button>

      {/* Hero */}
      <div className="crm-cl-hero">
        <div className="crm-cl-hero-icon">🛡</div>
        <h2 className="crm-cl-hero-title">Kairos Compliance</h2>
        <p className="crm-cl-hero-sub">
          Юридический анализ требований и запросов от контролирующих органов.
          Загрузите документ — получите правовую позицию и готовые ответы.
        </p>
        <div className="crm-cl-tags">
          {AUTHORITIES.map(a => <span key={a} className="crm-cl-tag">{a}</span>)}
        </div>
      </div>

      {/* Split: instructions | dropzone */}
      <div className="crm-cl-split">

        {/* Left — instructions */}
        <div className="crm-cl-info">
          <h3 className="crm-cl-section-title">Как работает</h3>
          <ol className="crm-cl-steps">
            {STEPS.map(s => (
              <li key={s.num} className="crm-cl-step">
                <span className="crm-cl-step-num">{s.num}</span>
                <div>
                  <strong className="crm-cl-step-title">{s.title}</strong>
                  <p className="crm-cl-step-text">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="crm-cl-dl-row">
            <button type="button" className="crm-cl-dl-btn"
              onClick={() => openDocPage(buildInstructionHtml())}
            >
              📄 Инструкция пользователя
            </button>
            <button type="button" className="crm-cl-dl-btn"
              onClick={() => openDocPage(buildPrivacyHtml())}
            >
              🔒 Политика конфиденциальности
            </button>
          </div>
          <p style={{ fontSize: 11, color: "#AAA098", margin: 0 }}>
            Откроются в новой вкладке · Ctrl+P → «Сохранить как PDF»
          </p>
        </div>

        {/* Right — dropzone */}
        <div className="crm-cl-upload-col">
          <div
            className="crm-cl-dropzone"
            onClick={() => inputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
          >
            <div className="crm-cl-dropzone-icon">🛡</div>
            <p className="crm-cl-dropzone-title">Загрузите требование</p>
            <p className="crm-cl-dropzone-hint">PDF, JPEG, PNG или TXT</p>
            <p className="crm-cl-dropzone-hint">Перетащите или нажмите</p>
            <div className="crm-cl-dropzone-btn">Выбрать файл</div>
          </div>
          {error && <p className="crm-v2-error" style={{ marginTop: 12 }}>{error}</p>}
          <input
            ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.txt"
            style={{ display: "none" }}
            onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = ""; }}
          />

          <div className="crm-cl-privacy-inline">
            <span className="crm-cl-lock">🔒</span>
            <p>
              Ваши документы хранятся <strong>только в вашем аккаунте</strong>.
              Никто кроме вас не имеет к ним доступа — ни третьи лица, ни сотрудники сервиса.
              Данные защищены шифрованием (TLS + Firebase).
            </p>
          </div>
        </div>
      </div>

      {/* Privacy policy collapsible */}
      <details className="crm-cl-privacy-details">
        <summary className="crm-cl-privacy-summary">
          🔒 Политика конфиденциальности и защита данных
        </summary>
        <div className="crm-cl-privacy-body">
          <p><strong>Субъект данных и доступ.</strong> Загруженные документы, извлечённый текст и история кейсов хранятся исключительно в вашем личном аккаунте. Доступ имеет только авторизованный пользователь. Сотрудники ООО «ОпенТрейдГрупп» не имеют доступа к содержимому ваших кейсов. Данные не передаются и не продаются третьим лицам.</p>
          <p><strong>Хранение и защита.</strong> Данные хранятся в Google Firebase (Firestore) с шифрованием при передаче (TLS 1.3) и хранении (AES-256). Инфраструктура Google Cloud сертифицирована по ISO 27001, SOC 2 Type II.</p>
          <p><strong>Удаление.</strong> Вы вправе удалить любой кейс в любое время. Полное удаление аккаунта — по запросу.</p>
          <p><strong>Правовое основание.</strong> ФЗ-152 «О персональных данных». Оператор: ООО «ОпенТрейдГрупп», ИНН 9703235411.</p>
          <p><strong>Ограничение ответственности.</strong> Kairos предоставляет информационный анализ, а не юридическую консультацию. Для окончательных решений рекомендуется обратиться к адвокату.</p>
          <button type="button" className="crm-cl-dl-btn" style={{ marginTop: 8 }}
            onClick={() => openDocPage(buildPrivacyHtml())}
          >
            📄 Открыть полную политику (для печати/PDF)
          </button>
        </div>
      </details>

    </div>
  );
}
