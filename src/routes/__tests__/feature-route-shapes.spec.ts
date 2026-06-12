// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { contracts } from './feature-route-schemas';

/**
 * Smoke + data-shape testy GP vendor feature-routes (ra-16, AUD-12-22).
 *
 * Data-shape jest egzekwowany przez **runtime schema zod** zdefiniowany w `feature-route-schemas.ts`
 * (SSOT kształtu). Test parsuje `sample` przez realny schema (`schema.parse`), a `driftSample` dowodzi,
 * że schema FAILuje przy shape-drift (mistyped / przemianowane / nadmiarowe pole). `sourceAnchors` są
 * weryfikowane jako realne klucze schemy obecne w pliku route (precyzyjny `\bfield\b` match).
 */

/** Zbiera wszystkie klucze obiektów ze schemy zod (rekursywnie przez array/nullable/optional/record). */
function collectFieldNames(schema: z.ZodTypeAny, acc: Set<string> = new Set()): Set<string> {
  const def = (
    schema as {
      _def?: {
        typeName?: string;
        type?: z.ZodTypeAny;
        innerType?: z.ZodTypeAny;
        valueType?: z.ZodTypeAny;
      };
    }
  )._def;
  if (!def) {
    return acc;
  }
  switch (def.typeName) {
    case 'ZodObject': {
      const shape = (schema as unknown as { shape: Record<string, z.ZodTypeAny> }).shape;
      for (const [key, child] of Object.entries(shape)) {
        acc.add(key);
        collectFieldNames(child, acc);
      }
      break;
    }
    case 'ZodArray':
      if (def.type) collectFieldNames(def.type, acc);
      break;
    case 'ZodNullable':
    case 'ZodOptional':
      if (def.innerType) collectFieldNames(def.innerType, acc);
      break;
    case 'ZodRecord':
      if (def.valueType) collectFieldNames(def.valueType, acc);
      break;
    default:
      break;
  }
  return acc;
}

describe('GP vendor feature-routes — smoke + data-shape (zod runtime schema = SSOT)', () => {
  it.each(contracts)('$name route module smoke-imports', async contract => {
    const mod = await import(contract.routeModule);
    expect(mod[contract.exportedComponent], contract.exportedComponent).toBeTypeOf('function');
  });

  it.each(contracts)('$name response validates against runtime zod schema (SSOT)', contract => {
    expect(() => contract.schema.parse(contract.sample)).not.toThrow();
  });

  it.each(contracts)('$name runtime schema rejects shape-drift', contract => {
    const result = contract.schema.safeParse(contract.driftSample);
    expect(
      result.success,
      `${contract.name}: drift sample must be rejected by the zod schema`
    ).toBe(false);
  });

  it.each(contracts)(
    '$name source anchors are real schema keys referenced by the route',
    contract => {
      const schemaFields = collectFieldNames(contract.schema);
      const source = readFileSync(path.join(process.cwd(), contract.sourceFile), 'utf8');
      for (const field of contract.sourceAnchors) {
        expect(
          schemaFields.has(field),
          `${field} must be a key in the zod schema (SSOT) for ${contract.name}`
        ).toBe(true);
        expect(
          new RegExp(`\\b${field}\\b`).test(source),
          `${contract.sourceFile} should reference contract field ${field}`
        ).toBe(true);
      }
    }
  );

  it('training cert route is gated instead of simulating a browser upload', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/routes/training-cert/training-cert-upload.tsx'),
      'utf8'
    );

    expect(source).toContain('upload_unavailable');
    expect(source).toContain('S2S HMAC-only');
    expect(source).not.toContain('type="file"');
    expect(source).not.toContain('Upload certificate');
    // Guard catches both quote styles to prevent setStatus regression.
    expect(source).not.toMatch(/setStatus\(["']pending_review["']\)/);
  });
});
