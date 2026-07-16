import { describe, it, expect } from "vitest";
import { validateEmail, validatePassword, validateName } from "./validation";

describe("validateEmail", () => {
  it("accepts a well-formed email", () => {
    expect(validateEmail("user@pingr.com")).toBe(true);
  });

  it("rejects strings without @", () => {
    expect(validateEmail("userpingr.com")).toBe(false);
  });

  it("rejects strings without a domain", () => {
    expect(validateEmail("user@pingr")).toBe(false);
  });

  it("rejects strings with spaces", () => {
    expect(validateEmail("user @pingr.com")).toBe(false);
  });
});

describe("validatePassword", () => {
  it("accepts a password with 6+ characters", () => {
    expect(validatePassword("123456")).toEqual({ valid: true });
  });

  it("rejects a password shorter than 6 characters", () => {
    const result = validatePassword("123");
    expect(result.valid).toBe(false);
    expect(result.message).toBeTruthy();
  });
});

describe("validateName", () => {
  it("accepts a name with 2+ characters", () => {
    expect(validateName("Jo")).toEqual({ valid: true });
  });

  it("rejects an empty name", () => {
    expect(validateName("").valid).toBe(false);
  });

  it("rejects a name that is only whitespace", () => {
    expect(validateName("   ").valid).toBe(false);
  });

  it("rejects a single-character name", () => {
    expect(validateName("A").valid).toBe(false);
  });
});
