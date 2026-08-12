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

const INSTRUCTION_TEXT = `ИНСТРУКЦИЯ ПОЛЬЗОВАТЕЛЯ — KAIROS COMPLIANCE
OpenTradeGroup · opentgp.ru/kairos

═══════════════════════════════════════════

КАК РАБОТАЕТ

1. ЗАГРУЗИТЕ ДОКУМЕНТ
   Загрузите скан, фото или PDF требования от контролирующего органа.
   Поддерживаемые форматы: PDF, JPEG, PNG, TXT.

2. KAIROS АНАЛИЗИРУЕТ
   Система автоматически определяет орган, тип документа и правовую базу.
   Анализ занимает 30–60 секунд.

3. ИЗУЧИТЕ АНАЛИЗ
   Вы получаете: суть документа, правовое основание, когда мера неприменима,
   последствия, варианты действий с конкретными сроками.

4. УТОЧНИТЕ ДЕТАЛИ (по желанию)
   Ответьте на уточняющие вопросы — и получите точную правовую позицию.
   Можно прикрепить дополнительные документы по делу.

5. СКАЧАЙТЕ ДОКУМЕНТЫ
   Kairos составит готовые документы для ответа: ходатайства, жалобы,
   пояснительные записки. Доступны в форматах TXT и DOC (Word).

═══════════════════════════════════════════

ПОДДЕРЖИВАЕМЫЕ ОРГАНЫ И СИТУАЦИИ

• ФНС — камеральная, выездная, встречная проверки
• МВД / Полиция — запросы и уведомления
• Прокуратура — представления и запросы
• ФССП / Судебные приставы — исполнительные производства
• Банк (115-ФЗ) — запросы комплаенса, блокировки
• ГИТ (Государственная инспекция труда) — предписания
• Суд — определения, запросы, уведомления
• Контрагент — запросы сверки и документов

═══════════════════════════════════════════

КОНФИДЕНЦИАЛЬНОСТЬ И ЗАЩИТА ДАННЫХ

Все загруженные документы хранятся исключительно в вашем личном аккаунте.
Доступ к данным имеет только авторизованный пользователь — никто другой,
включая сотрудников OpenTradeGroup, не имеет доступа к вашим документам.

Kairos не передаёт ваши документы и данные третьим лицам.
Данные защищены шифрованием при передаче (TLS) и хранении (Firebase / Google Cloud).

Правовое основание: ФЗ-152 «О персональных данных».

═══════════════════════════════════════════

ВАЖНО

Kairos предоставляет информационный анализ, а не юридическую консультацию.
Для принятия окончательных решений рекомендуется обратиться к адвокату.

© OpenTradeGroup · 2025
`;

const PRIVACY_TEXT = `ПОЛИТИКА КОНФИДЕНЦИАЛЬНОСТИ — KAIROS COMPLIANCE
OpenTradeGroup · opentgp.ru/kairos

1. СУБЪЕКТ ДАННЫХ И ОПЕРАТОР
   Оператор: ООО «ОпенТрейдГрупп» (OpenTradeGroup).
   Субъект: авторизованный пользователь системы Kairos.

2. СОСТАВ ДАННЫХ
   Система обрабатывает: загруженные пользователем документы (PDF, изображения),
   извлечённый из них текст, историю кейсов в рамках аккаунта пользователя.

3. ДОСТУП
   Доступ к данным имеет исключительно авторизованный пользователь.
   Сотрудники OpenTradeGroup технического доступа к содержимому кейсов не имеют.
   Данные не передаются и не продаются третьим лицам.

4. ХРАНЕНИЕ И ЗАЩИТА
   Данные хранятся в Google Firebase (Firestore) с шифрованием при передаче (TLS 1.3)
   и хранении. Инфраструктура Google Cloud соответствует ISO 27001, SOC 2.

5. УДАЛЕНИЕ
   Пользователь вправе удалить любой кейс и все связанные данные в любое время.

6. ПРАВОВОЕ ОСНОВАНИЕ
   Федеральный закон № 152-ФЗ «О персональных данных».

© OpenTradeGroup · 2025
`;

function triggerBlobDownload(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

      {/* Back */}
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

      {/* Split */}
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
              onClick={() => triggerBlobDownload(INSTRUCTION_TEXT, "Kairos_Compliance_Инструкция.txt")}
            >
              ↓ Инструкция .txt
            </button>
            <button type="button" className="crm-cl-dl-btn"
              onClick={() => triggerBlobDownload(PRIVACY_TEXT, "Kairos_Compliance_Политика_конфиденциальности.txt")}
            >
              ↓ Политика конф. .txt
            </button>
          </div>
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

          {/* Privacy notice inline */}
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

      {/* Privacy policy full block */}
      <details className="crm-cl-privacy-details">
        <summary className="crm-cl-privacy-summary">
          🔒 Политика конфиденциальности и защита данных
        </summary>
        <div className="crm-cl-privacy-body">
          <p><strong>Субъект данных и доступ.</strong> Загруженные документы, извлечённый текст и история кейсов хранятся исключительно в вашем личном аккаунте. Доступ имеет только авторизованный пользователь. Сотрудники OpenTradeGroup не имеют доступа к содержимому ваших кейсов. Данные не передаются и не продаются третьим лицам.</p>
          <p><strong>Хранение и защита.</strong> Данные хранятся в Google Firebase (Firestore) с шифрованием при передаче (TLS 1.3) и хранении. Инфраструктура Google Cloud сертифицирована по ISO 27001, SOC 2.</p>
          <p><strong>Удаление.</strong> Вы вправе удалить любой кейс в любое время.</p>
          <p><strong>Правовое основание.</strong> ФЗ-152 «О персональных данных».</p>
          <p><strong>Отказ от ответственности.</strong> Kairos предоставляет информационный анализ, а не юридическую консультацию. Для окончательных решений рекомендуется консультация адвоката.</p>
        </div>
      </details>

    </div>
  );
}
