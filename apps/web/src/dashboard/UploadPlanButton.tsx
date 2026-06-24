/**
 * UploadPlanButton — файловый пикер для загрузки бизнес-плана.
 *
 * Только UI: принимает PDF/DOCX/TXT, показывает имя выбранного файла.
 * AI-оценка не реализована — кнопка «Оценить план» заблокирована с честной
 * подсказкой.
 */

import { useRef, useState } from "react";

const ACCEPTED = ".pdf,.docx,.txt";

export function UploadPlanButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  function handleClick() {
    inputRef.current?.click();
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
    }
    // Сбрасываем value чтобы повторный выбор того же файла тоже срабатывал
    e.target.value = "";
  }

  return (
    <div className="upload-plan-group">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        onChange={handleChange}
        style={{ display: "none" }}
        aria-label="Выберите файл бизнес-плана"
      />

      <button
        type="button"
        className="upload-plan-btn"
        onClick={handleClick}
      >
        {fileName ? "Сменить файл" : "Загрузить план"}
      </button>

      {fileName && (
        <span className="upload-plan-filename" title={fileName}>
          {fileName}
        </span>
      )}

      <button
        type="button"
        className="upload-plan-btn upload-plan-btn--assess"
        disabled
        title="AI-оценка: скоро"
      >
        Оценить план
      </button>
    </div>
  );
}
