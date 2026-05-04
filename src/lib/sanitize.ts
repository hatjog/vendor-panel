// @last-synced-from: fd878d80a8388690b66c99d4c48689cecb528f37 (packages/sanitize/src/index.ts SANITIZE_VERSION=v1.6.0-15b-hardened)
/**
 * @gp/sanitize — Canonical hardened HTML sanitizer for GP panels.
 *
 * cleanup-15b: scheme-anchored URI allowlist + per-tag attr enforcement +
 * entity pre-decode (mXSS closure) + HTML comment stripping.
 *
 * SANITIZE_VERSION identifies this exact build; panel copies carry a
 * `// @last-synced-from: <super-sha>` header that must match.
 *
 * Trust boundary (AR50 + NFR-SEC-3):
 *   Backend stores raw HTML for audit fidelity; sanitization is enforced
 *   at render time in each panel. This module is the single canonical source.
 *
 * Library: `isomorphic-dompurify` — DOMPurify with JSDOM auto-bootstrap
 *   for SSR (Next.js 15 RSC, Express, etc.). Works identically in browsers.
 *
 * @see https://github.com/cure53/DOMPurify
 * @see https://owasp.org/www-project-top-ten/2017/A7_2017-Cross-Site_Scripting_(XSS)
 */

import DOMPurify from 'isomorphic-dompurify'
import he from 'he'

/** Version string; panel copies must carry matching `@last-synced-from` comment. */
export const SANITIZE_VERSION = 'v1.6.0-15b-hardened'

/**
 * Scheme-anchored URI allowlist.
 *
 * cleanup-15b hardening vs previous `[^:]*$` regex:
 *   - Rejects schemeless payloads that contain a colon later (e.g. onclick="...")
 *   - Rejects percent-encoded schemes like %6Aavascript:
 *   - Rejects full-width Unicode schemes (ＪＡＶＡＳＣＲＩＰＴ:)
 *   - Explicit deny: data:, javascript:, vbscript:, file:, blob:
 *
 * Allowed:
 *   - https:  — absolute HTTPS link
 *   - mailto: — email link
 *   - /       — relative path (starts with slash)
 *   - #       — in-page anchor
 *
 * Note: http: intentionally excluded; force HTTPS per security policy.
 * If http: is needed for specific use cases, create a named opt-in.
 */
export const ALLOWED_URI_REGEXP = /^(https:|mailto:|\/|#)/i

/**
 * Allowed HTML tags for user/partner content.
 * Intentionally narrow: only formatting + structure + links.
 * No media tags, no interactive elements, no scripting surfaces.
 */
export const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'b',
  'i',
  'u',
  'ul',
  'ol',
  'li',
  'a',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'code',
  'pre',
  'span',
]

/**
 * Global allowed attributes.
 * Per-tag enforcement is done by afterSanitizeAttributes hook below:
 *   <a>: href, rel, target ONLY (no title, no formaction)
 *   <img>: src, alt, loading ONLY
 */
export const ALLOWED_ATTR = ['href', 'rel', 'target', 'class']

/**
 * Absolutely forbidden tags — removed along with all content.
 * These cannot appear in allowed output under any circumstances.
 */
export const FORBID_TAGS = [
  'script',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'style',
  'link',
  'meta',
  'base',
  'svg',
  'math',
  'canvas',
  'video',
  'audio',
  'template',
  'slot',
  'portal',
]

/**
 * Forbidden attributes — stripped from any element regardless of tag.
 * Covers event handlers pattern + dangerous attribute names.
 */
export const FORBID_ATTR = [
  'style',
  'srcset',
  'formaction',
  'action',
  'ping',
  'title',
  'xlink:href',
  'xmlns',
  'xmlns:xlink',
]

let hookInstalled = false

/**
 * Install DOMPurify hooks (idempotent) for per-tag attribute enforcement.
 *
 * <a> tag: keeps ONLY href, rel, target — strips title, formaction, onclick, etc.
 *   Enforces rel="noopener noreferrer" on any link with href.
 */
function ensureHooks(): void {
  if (hookInstalled) return

  DOMPurify.addHook('afterSanitizeAttributes', (node: Element) => {
    if (node.tagName === 'A') {
      if (node.hasAttribute('href')) {
        node.setAttribute('rel', 'noopener noreferrer')
      }
      // Strip every attribute not in strict <a> allowlist
      const allowedAnchorAttrs = new Set(['href', 'rel', 'target'])
      for (const attr of Array.from(node.attributes)) {
        if (!allowedAnchorAttrs.has(attr.name)) {
          node.removeAttribute(attr.name)
        }
      }
    }

    if (node.tagName === 'IMG') {
      // <img> keeps src, alt, loading only
      const allowedImgAttrs = new Set(['src', 'alt', 'loading'])
      for (const attr of Array.from(node.attributes)) {
        if (!allowedImgAttrs.has(attr.name)) {
          node.removeAttribute(attr.name)
        }
      }
    }
  })

  // Strip HTML comments before parsing (mXSS via conditional comments)
  DOMPurify.addHook('beforeSanitizeElements', (node) => {
    if (node.nodeType === 8) {
      // Node.COMMENT_NODE = 8
      node.parentNode?.removeChild(node)
    }
  })

  hookInstalled = true
}

/**
 * Sanitize partner-imported / user-content HTML for safe DOM injection.
 *
 * Pipeline (cleanup-15b):
 *  1. Null/empty guard
 *  2. HTML entity pre-decode (he.decode) — closes mXSS via &lt;script&gt; encoding
 *  3. Strip HTML comments — closes mXSS via <!--[if IE]><script>... conditional
 *  4. DOMPurify with:
 *     - FORBID_TAGS: removes dangerous elements entirely
 *     - FORBID_ATTR: removes dangerous attributes globally
 *     - ALLOWED_URI_REGEXP: scheme-anchored — rejects data:, javascript:, vbscript:,
 *       file:, schemeless, percent-encoded, and full-width Unicode variants
 *  5. afterSanitizeAttributes hook: per-tag strict attr enforcement
 *
 * @param html  Raw HTML string (or nullable) from user or partner source.
 * @param opts  Optional override for allowed tags/attrs (advanced use only).
 * @returns     Sanitized HTML string; safe for dangerouslySetInnerHTML / innerHTML.
 */
export function sanitizeHtml(
  html: string | null | undefined,
  opts?: { allowedTags?: string[]; allowedAttr?: string[] },
): string {
  if (html === null || html === undefined || html === '') {
    return ''
  }

  ensureHooks()

  // Step 2: Entity pre-decode (prevents &lt;script&gt;alert(1)&lt;/script&gt; bypass)
  const decoded = he.decode(html)

  // Step 3: Strip HTML comments before DOMPurify (IE conditional comment mXSS)
  const noComments = decoded.replace(/<!--[\s\S]*?-->/g, '')

  // Step 4+5: DOMPurify with hardened config
  return DOMPurify.sanitize(noComments, {
    ALLOWED_TAGS: opts?.allowedTags ?? ALLOWED_TAGS,
    ALLOWED_ATTR: opts?.allowedAttr ?? ALLOWED_ATTR,
    FORBID_TAGS,
    FORBID_ATTR,
    ALLOWED_URI_REGEXP,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    FORCE_BODY: false,
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
  }) as string
}

export default sanitizeHtml
