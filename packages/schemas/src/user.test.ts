import { describe, it, expect } from "vitest";
import { UserProfile } from "./user.js";

describe("UserProfile schema", () => {
  const valid = {
    uid: "abc123",
    email: "test@example.com",
    createdAt: "2026-07-31T10:00:00.000Z",
    businessId: "biz-uuid-here",
    emailVerified: false,
    displayName: null,
  };

  it("принимает валидный профиль", () => {
    expect(() => UserProfile.parse(valid)).not.toThrow();
  });

  it("отклоняет пустой uid", () => {
    expect(() => UserProfile.parse({ ...valid, uid: "" })).toThrow();
  });

  it("отклоняет невалидный email", () => {
    expect(() => UserProfile.parse({ ...valid, email: "not-an-email" })).toThrow();
  });

  it("отклоняет пустой businessId", () => {
    expect(() => UserProfile.parse({ ...valid, businessId: "" })).toThrow();
  });

  it("принимает displayName: null", () => {
    const result = UserProfile.parse({ ...valid, displayName: null });
    expect(result.displayName).toBeNull();
  });

  it("принимает displayName: строка", () => {
    const result = UserProfile.parse({ ...valid, displayName: "Анна" });
    expect(result.displayName).toBe("Анна");
  });

  it("strict: отклоняет лишние поля", () => {
    expect(() => UserProfile.parse({ ...valid, extraField: "oops" })).toThrow();
  });
});
