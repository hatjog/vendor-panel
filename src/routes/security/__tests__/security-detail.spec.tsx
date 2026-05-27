import { describe, expect, it } from 'vitest';

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
