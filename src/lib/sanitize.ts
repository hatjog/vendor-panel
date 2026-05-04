/**
 * HTML sanitizer for vendor-panel — Story v160-cleanup-4.
 *
 * last-synced-from: e4b400a60e7b5866794b35b249c62b3a895ce9c9 (packages/sanitize/src/index.ts)
 *
 * CANONICAL SOURCE: packages/sanitize/src/index.ts in the GP superproject.
 * This is a sub-repo copy (cross-repo workspace links are not viable for hatjog/* forks).
 * See packages/sanitize/README.md for the sync policy.
 *
 * Closes:
 *   CRIT-7.3  entity-encoded XSS bypass (entity pre-decode pass)
 *   CRIT-7.3  mXSS HTML comment bypass (ALLOW_COMMENTS:false)
 *   CRIT-7.3  formaction on anchor (FORBID_ATTR includes 'formaction')
 *   HIGH-4.1  title= on <a> URL-shadow phishing (per-tag afterSanitizeAttributes hook)
 *   HIGH-4.1  over-permissive ALLOWED_URI_REGEXP (tightened to docstring contract)
 *
 * Version: v1.6.0-cleanup4-dompurify
 */

import DOMPurify from 'isomorphic-dompurify'
import he from 'he'

export const SANITIZE_VERSION = 'v1.6.0-cleanup4-dompurify'

export type SanitizeProfile =
  | 'vendor-description'
  | 'admin-note'
  | 'inline'
  | 'strict'

const BASE_ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'b', 'i', 'u',
  'ul', 'ol', 'li',
  'a',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'code', 'pre',
  'span',
]

const INLINE_ALLOWED_TAGS = ['strong', 'em', 'b', 'i', 'u', 'span', 'a', 'code']

const FORBID_TAGS = [
  'script', 'iframe', 'object', 'embed',
  'form', 'input', 'button', 'textarea', 'select',
  'style', 'link', 'meta', 'base',
  'svg', 'math',
  'canvas', 'video', 'audio', 'source', 'track',
]

const FORBID_ATTR = ['style', 'srcset', 'formaction', 'action', 'ping']

/**
 * Permitted URI schemes for href.
 * Rejected: javascript:, data:, vbscript:, file:, blob:
 */
export const ALLOWED_URI_REGEXP =
  /^(?:(?:https?|mailto|tel):|\/|[^:]*$|#)/i

let hooksInstalled = false

function ensureHooks(): void {
  if (hooksInstalled) return
  DOMPurify.addHook('afterSanitizeAttributes', (node: Element) => {
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      node.setAttribute('rel', 'noopener noreferrer')
      const allowed = new Set(['href', 'rel', 'target'])
      for (const attr of Array.from(node.attributes)) {
        if (!allowed.has(attr.name)) {
          node.removeAttribute(attr.name)
        }
      }
    }
  })
  hooksInstalled = true
}

// DOMPurify@3.4 Config type doesn't include ALLOW_COMMENTS; cast to bypass TS2353.
// DOMPurify strips HTML comments by default in JSDOM/Node context.
type DPConfig = Parameters<typeof DOMPurify.sanitize>[1]

function buildConfig(profile: SanitizeProfile): DPConfig {
  if (profile === 'strict') {
    return {
      ALLOWED_TAGS: [],
      ALLOWED_ATTR: [],
      FORBID_TAGS,
      FORBID_ATTR,
      ALLOW_COMMENTS: false,
      RETURN_DOM: false,
      RETURN_DOM_FRAGMENT: false,
    } as DPConfig
  }
  const allowedTags = profile === 'inline' ? INLINE_ALLOWED_TAGS : BASE_ALLOWED_TAGS
  return {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: ['class', 'rel', 'target', 'href', 'src', 'alt', 'width', 'height', 'cite'],
    FORBID_TAGS,
    FORBID_ATTR,
    ALLOWED_URI_REGEXP,
    ALLOW_COMMENTS: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
  } as DPConfig
}

/**
 * Sanitize untrusted HTML for safe React DOM injection.
 * Steps: null guard → entity decode (he) → DOMPurify + per-tag hook.
 */
export function sanitizeHtml(
  dirty: string | null | undefined,
  profile: SanitizeProfile = 'vendor-description',
): string {
  if (dirty === null || dirty === undefined || dirty === '') return ''
  ensureHooks()
  const decoded = he.decode(dirty)
  return DOMPurify.sanitize(decoded, buildConfig(profile)) as string
}
