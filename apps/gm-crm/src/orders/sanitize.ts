import DOMPurify from "dompurify";

// Отдельный экземпляр: хук ниже не должен влиять на другие вызовы DOMPurify в приложении.
const purify = DOMPurify(window);

purify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

/**
 * Очистка HTML входящих писем перед dangerouslySetInnerHTML.
 * on*-атрибуты и javascript:/data:-ссылки DOMPurify режет по умолчанию;
 * <style> запрещён, т.к. стили письма иначе применятся ко всей CRM.
 * Внешние картинки оставлены — это трекинг-пиксели, но не исполнение кода.
 */
export function sanitizeEmailHtml(html: string): string {
  return purify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "iframe", "frame", "object", "embed", "form", "input", "button",
      "textarea", "select", "style", "link", "meta", "base"],
    FORBID_ATTR: ["formaction", "action", "srcdoc"],
  });
}
