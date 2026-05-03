/**
 * Story v160-7-8: HTML sanitizer for vendor-panel.
 *
 * Mirrors admin-panel + storefront sanitize contract (Story 4.7 baseline +
 * Sprint 4 Wave 15 extension). Per T2.1 decision: per-repo copy (no monorepo
 * package overhead in v1.6.0).
 *
 * Wave 15 ships minimal regex-based sanitizer to avoid lockfile drift.
 * Sprint 5 polish: drop in isomorphic-dompurify for full DOM-aware parsing.
 */

const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "em",
  "u",
  "ol",
  "ul",
  "li",
  "a",
  "h1",
  "h2",
  "h3",
  "h4",
  "blockquote",
  "code",
  "pre",
])

const ALLOWED_PROTOCOLS = ["http://", "https://", "mailto:"]

const STRIPPED_TAG_PATTERNS = [
  /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,
  /<script\b[^>]*\/?>/gi,
  /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,
  /<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi,
  /<iframe\b[^>]*\/?>/gi,
  /<object\b[^>]*>[\s\S]*?<\/object\s*>/gi,
  /<embed\b[^>]*\/?>/gi,
  /<link\b[^>]*\/?>/gi,
  /<meta\b[^>]*\/?>/gi,
  /<base\b[^>]*\/?>/gi,
  /<form\b[^>]*>[\s\S]*?<\/form\s*>/gi,
  /<input\b[^>]*\/?>/gi,
  /<button\b[^>]*>[\s\S]*?<\/button\s*>/gi,
  /<svg\b[^>]*>[\s\S]*?<\/svg\s*>/gi,
  /<math\b[^>]*>[\s\S]*?<\/math\s*>/gi,
]

const ON_HANDLER_PATTERN = /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi
const STYLE_ATTR_PATTERN = /\sstyle\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi
const SRCSET_ATTR_PATTERN = /\ssrcset\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi
const DATA_ATTR_PATTERN = /\sdata-[a-z][\w-]*\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi

const TAG_PATTERN = /<\/?([a-z][\w-]*)\b[^>]*>/gi

function stripDangerousProtocols(html: string): string {
  return html.replace(
    /\shref\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi,
    (_match, value: string) => {
      const trimmed = value.replace(/^["']|["']$/g, "").trim().toLowerCase()
      const safe = ALLOWED_PROTOCOLS.some((p) => trimmed.startsWith(p))
      if (safe) {
        return ` href="${value.replace(/^["']|["']$/g, "")}" rel="noopener noreferrer nofollow" target="_blank"`
      }
      return ' href="#"'
    },
  )
}

export function sanitizeHtml(dirty: string): string {
  if (!dirty) return ""

  let out = dirty

  for (const pat of STRIPPED_TAG_PATTERNS) {
    out = out.replace(pat, "")
  }

  out = out.replace(ON_HANDLER_PATTERN, "")
  out = out.replace(STYLE_ATTR_PATTERN, "")
  out = out.replace(SRCSET_ATTR_PATTERN, "")
  out = out.replace(DATA_ATTR_PATTERN, "")

  out = stripDangerousProtocols(out)

  out = out.replace(TAG_PATTERN, (match, tagName: string) => {
    return ALLOWED_TAGS.has(tagName.toLowerCase()) ? match : ""
  })

  return out
}

export const SANITIZE_VERSION = "v1.6.0-7.8-regex-baseline"
