/**
 * Vendor-panel sanitize bypass fixture tests — Story v160-cleanup-4
 * Mirrors packages/sanitize/src/index.test.ts
 */

// @vitest-environment node
import { describe, expect, it } from "vitest"
import { sanitizeHtml, ALLOWED_URI_REGEXP, SANITIZE_VERSION } from "../sanitize"

describe("sanitize (vendor-panel) — bypass fixture tests", () => {
  // AC5(a) entity-encoded XSS
  it("strips entity-encoded <script>", () => {
    const out = sanitizeHtml("&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(out.toLowerCase()).not.toContain("<script")
    expect(out).not.toContain("alert(1)")
  })

  it("strips entity-encoded onerror attribute", () => {
    const out = sanitizeHtml('&lt;img src=x onerror="alert(1)"&gt;')
    expect(out).not.toContain("alert(1)")
    expect(out.toLowerCase()).not.toContain("onerror")
  })

  // AC5(b) mXSS HTML comment bypass
  it("strips HTML comments (mXSS prevention)", () => {
    const out = sanitizeHtml(
      "<!--<script>alert(1)//--><img src=x onerror=alert(1)>",
    )
    expect(out).not.toContain("<!--")
    expect(out.toLowerCase()).not.toContain("<script")
    expect(out.toLowerCase()).not.toContain("onerror")
  })

  // AC5(c) formaction on anchor
  it("strips formaction attribute from <a>", () => {
    const out = sanitizeHtml(
      '<a formaction="javascript:alert(1)" href="https://example.com">click</a>',
    )
    expect(out.toLowerCase()).not.toContain("formaction")
    expect(out).toContain('href="https://example.com"')
  })

  // AC5(d) title= phishing + mixed-case javascript href
  it("strips title from <a> (URL-shadow phishing)", () => {
    const out = sanitizeHtml(
      '<a title="https://evil.com" href="https://safe.com">click</a>',
    )
    expect(out.toLowerCase()).not.toContain("title=")
  })

  it("neutralises javascript: href (mixed-case HREF)", () => {
    const out = sanitizeHtml('<a TITLE="x" HREF="javascript:alert(1)">click</a>')
    expect(out.toLowerCase()).not.toContain("javascript:")
    expect(out.toLowerCase()).not.toContain("title=")
  })

  // AC3 per-tag allowlist
  it("enforces rel=noopener noreferrer on <a>", () => {
    const out = sanitizeHtml('<a href="https://example.com">link</a>')
    expect(out).toContain('rel="noopener noreferrer"')
  })

  // AC6 ALLOWED_URI_REGEXP
  it("ALLOWED_URI_REGEXP rejects javascript:", () => {
    expect(ALLOWED_URI_REGEXP.test("javascript:alert(1)")).toBe(false)
  })

  it("ALLOWED_URI_REGEXP rejects data:", () => {
    expect(ALLOWED_URI_REGEXP.test("data:text/html,payload")).toBe(false)
  })

  it("ALLOWED_URI_REGEXP rejects vbscript:", () => {
    expect(ALLOWED_URI_REGEXP.test("vbscript:msgbox(1)")).toBe(false)
  })

  it("ALLOWED_URI_REGEXP rejects file:", () => {
    expect(ALLOWED_URI_REGEXP.test("file:///etc/passwd")).toBe(false)
  })

  it("ALLOWED_URI_REGEXP allows https:", () => {
    expect(ALLOWED_URI_REGEXP.test("https://example.com")).toBe(true)
  })

  it("ALLOWED_URI_REGEXP allows mailto:", () => {
    expect(ALLOWED_URI_REGEXP.test("mailto:test@example.com")).toBe(true)
  })

  it("ALLOWED_URI_REGEXP allows relative path", () => {
    expect(ALLOWED_URI_REGEXP.test("/relative/path")).toBe(true)
  })

  // AC4 SANITIZE_VERSION
  it("exports SANITIZE_VERSION with 15b-hardened marker", () => {
    expect(SANITIZE_VERSION).toContain("15b-hardened")
  })

  // Null/empty guard
  it("returns empty for null", () => expect(sanitizeHtml(null)).toBe(""))
  it("returns empty for undefined", () => expect(sanitizeHtml(undefined)).toBe(""))
  it("returns empty for empty string", () => expect(sanitizeHtml("")).toBe(""))

  // Benign content preserved
  it("preserves allowed tags", () => {
    const out = sanitizeHtml("<p>Hello <strong>world</strong></p>")
    expect(out).toContain("<p>")
    expect(out).toContain("<strong>world</strong>")
  })
})
