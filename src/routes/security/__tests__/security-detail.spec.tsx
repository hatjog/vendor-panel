import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseRetryAfterSeconds } from '../../../hooks/api/sessions';

describe('security session retry handling', () => {
  it('uses Retry-After header before body fallback', () => {
    expect(parseRetryAfterSeconds('20', 5)).toBe(20);
  });

  it('uses response body retry seconds when header is missing', () => {
    expect(parseRetryAfterSeconds(null, 12)).toBe(12);
  });

  it('falls back to 20 seconds for invalid retry-after values', () => {
    expect(parseRetryAfterSeconds('invalid', undefined)).toBe(20);
  });
});

describe('vendor logout cookie clearing (F-02)', () => {
  // Lightweight document/window stub so the helper can run under the default
  // Node test env without pulling in jsdom (deferred to F-01 follow-up).
  let cookieJar: string[] = [];
  const originalGlobals = {
    document: globalThis.document,
    window: globalThis.window
  };

  beforeEach(() => {
    cookieJar = [];
    const fakeDocument = {
      get cookie() {
        return '';
      },
      set cookie(value: string) {
        cookieJar.push(value);
      }
    } as unknown as Document;

    const fakeWindow = {
      location: { hostname: 'panel.bonbeauty.example' },
      localStorage: { removeItem: vi.fn() }
    } as unknown as Window & typeof globalThis;

    vi.stubGlobal('document', fakeDocument);
    vi.stubGlobal('window', fakeWindow);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalGlobals.document) {
      vi.stubGlobal('document', originalGlobals.document);
    }
    if (originalGlobals.window) {
      vi.stubGlobal('window', originalGlobals.window);
    }
    vi.unstubAllGlobals();
  });

  it('emits Secure; SameSite=None and Domain variants so cross-subdomain cookies are deleted', async () => {
    const { clearVendorSessionCookies } = await import('../../../lib/auth/vendor-logout');

    clearVendorSessionCookies();

    const sidEmits = cookieJar.filter(entry => entry.startsWith('connect.sid='));
    expect(sidEmits.some(entry => /SameSite=None; Secure/.test(entry))).toBe(true);
    expect(sidEmits.some(entry => /Domain=\.bonbeauty\.example/.test(entry))).toBe(true);
    expect(sidEmits.some(entry => /Domain=panel\.bonbeauty\.example/.test(entry))).toBe(true);
    expect(sidEmits.some(entry => entry === 'connect.sid=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/')).toBe(true);
  });

  it('omits Domain attribute on localhost (invalid Set-Cookie domain)', async () => {
    vi.stubGlobal('window', {
      location: { hostname: 'localhost' },
      localStorage: { removeItem: vi.fn() }
    } as unknown as Window & typeof globalThis);

    vi.resetModules();
    const { clearVendorSessionCookies } = await import('../../../lib/auth/vendor-logout');

    clearVendorSessionCookies();

    expect(cookieJar.every(entry => !/Domain=/.test(entry))).toBe(true);
  });
});
