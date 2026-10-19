import { sanitizeEmailHtml } from "./sanitize";

describe("sanitizeEmailHtml", () => {
  it("убирает onerror у img, картинку оставляет", () => {
    const out = sanitizeEmailHtml(`<img src="https://x.ru/a.png" onerror="alert(1)">`);
    expect(out).not.toMatch(/onerror/i);
    expect(out).toContain(`src="https://x.ru/a.png"`);
  });

  it("убирает svg с onload", () => {
    const out = sanitizeEmailHtml(`<p>hi</p><svg onload="alert(1)"><circle r="1"/></svg>`);
    expect(out).not.toMatch(/onload|<svg/i);
    expect(out).toContain("<p>hi</p>");
  });

  it("убирает javascript: из ссылок и открывает ссылки в новой вкладке", () => {
    const bad = sanitizeEmailHtml(`<a href="javascript:alert(1)">x</a>`);
    expect(bad).not.toMatch(/javascript:/i);
    const good = sanitizeEmailHtml(`<a href="https://ok.ru">ok</a>`);
    expect(good).toContain(`target="_blank"`);
    expect(good).toContain(`rel="noopener noreferrer"`);
  });

  it("убирает script, iframe, object, form и style", () => {
    const out = sanitizeEmailHtml(
      `<script>alert(1)</script><iframe src="https://e.ru"></iframe><object data="x"></object>` +
      `<form action="https://e.ru"><input name="p"></form><style>body{display:none}</style><b>ok</b>`,
    );
    expect(out).not.toMatch(/<script|<iframe|<object|<form|<input|<style/i);
    expect(out).toContain("<b>ok</b>");
  });

  it("сохраняет инлайн-стили письма", () => {
    expect(sanitizeEmailHtml(`<p style="color:red">t</p>`)).toContain(`style="color:red"`);
  });
});
