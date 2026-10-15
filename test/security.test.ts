import { describe, expect, it } from "vitest";
import { assertSafeRemoteUrl, canonicalUrl, normalizeText, sanitizeText } from "../src/security.js";
import { detectLanguage } from "../src/services/translation.js";

describe("security and normalization", () => {
  it("normalizes tracking URLs", () => expect(canonicalUrl("HTTPS://Example.COM/a?utm_source=x#fragment")).toBe("https://example.com/a"));
  it("strips executable HTML from feeds", () => expect(sanitizeText("<script>alert(1)</script><b>Hello</b>")).toBe("Hello"));
  it("normalizes Persian text", () => expect(normalizeText("خبر\u200c تازه!")).toBe("خبر تازه"));
  it("rejects local SSRF destinations", async () => { await expect(assertSafeRemoteUrl("http://127.0.0.1:8080/feed")).rejects.toThrow(/Private|local/); await expect(assertSafeRemoteUrl("file:///etc/passwd")).rejects.toThrow(/http/); });
});

describe("language detection", () => {
  it("recognizes Persian and Arabic scripts", () => { expect(detectLanguage("این یک خبر آزمایشی است")).toBe("fa"); expect(detectLanguage("هذا خبر تجريبي")).toBe("ar"); });
  it("recognizes Latin language as English by default", () => expect(detectLanguage("A fictional safety bulletin")).toBe("en"));
});
