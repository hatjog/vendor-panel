/**
 * SSOT (single source of truth) kształtu odpowiedzi/loadera GP vendor feature-routes (ra-16).
 *
 * Każdy kontrakt ma **runtime schema zod** (`.strict()`), egzekwowany przez `feature-route-shapes.spec.ts`.
 * Schema — nie ręcznie autorski `shape` literal — jest SSOT kształtu: test parsuje `sample` przez schema
 * (runtime walidacja), a `driftSample` dowodzi, że schema FAILuje przy shape-drift. `sourceAnchors` to
 * realne klucze schemy obecne w pliku route (precyzyjny `\bfield\b` match), więc rename realnego pola
 * — w route albo w schemie — jest łapany jako drift.
 */
import { z } from 'zod';

const iso = '2026-06-12T10:00:00.000Z';

/**
 * training cert upload (Wave-15 stub route).
 * Realny kontrakt to enum statusu certyfikatu (`CertStatus`) + ograniczenia uploadu. `status` jest
 * jedynym polem kontraktu obecnym w route jako klucz; pozostałe pola modelują docelowy response DTO.
 */
export const trainingCertUploadSchema = z
  .object({
    status: z.enum(['awaiting', 'pending_review', 'verified', 'rejected']),
    allowed_extensions: z.array(z.string()).min(1),
    max_size_bytes: z.number(),
    rejection_reason: z.string().nullable()
  })
  .strict();

/** competitive insights dashboard */
export const competitiveInsightsSchema = z
  .object({
    vendor_id: z.string(),
    generated_at: z.string(),
    categories: z
      .array(
        z
          .object({
            category_id: z.string(),
            category_name: z.string(),
            product_count: z.number(),
            vendor_avg_price: z.number(),
            market_avg_price: z.number(),
            percentile: z.number(),
            position_label: z.enum([
              'top_quartile',
              'above_average',
              'below_average',
              'bottom_quartile',
              'solo_vendor'
            ])
          })
          .strict()
      )
      .min(1)
  })
  .strict();

export type RouteContract = {
  name: string;
  routeModule: string;
  sourceFile: string;
  exportedComponent: string;
  schema: z.ZodTypeAny;
  sample: unknown;
  driftSample: unknown;
  sourceAnchors: string[];
};

export const contracts: RouteContract[] = [
  {
    name: 'training cert upload',
    routeModule: '../training-cert',
    sourceFile: 'src/routes/training-cert/training-cert-upload.tsx',
    exportedComponent: 'Component',
    schema: trainingCertUploadSchema,
    sourceAnchors: ['status'],
    sample: {
      status: 'pending_review',
      allowed_extensions: ['.pdf', '.jpg', '.jpeg', '.png'],
      max_size_bytes: 10485760,
      rejection_reason: null
    },
    // drift: status poza enum CertStatus
    driftSample: {
      status: 'in_review',
      allowed_extensions: ['.pdf', '.jpg', '.jpeg', '.png'],
      max_size_bytes: 10485760,
      rejection_reason: null
    }
  },
  {
    name: 'competitive insights',
    routeModule: '../dashboard/insights',
    sourceFile: 'src/routes/dashboard/insights/competitive-insights-widget.tsx',
    exportedComponent: 'Component',
    schema: competitiveInsightsSchema,
    sourceAnchors: [
      'vendor_avg_price',
      'market_avg_price',
      'percentile',
      'position_label',
      'category_id',
      'category_name',
      'product_count'
    ],
    sample: {
      vendor_id: 'vendor_1',
      generated_at: iso,
      categories: [
        {
          category_id: 'cat_1',
          category_name: 'Spa',
          product_count: 3,
          vendor_avg_price: 10000,
          market_avg_price: 12000,
          percentile: 70,
          position_label: 'above_average'
        }
      ]
    },
    // drift: vendor_avg_price mistyped (string zamiast number)
    driftSample: {
      vendor_id: 'vendor_1',
      generated_at: iso,
      categories: [
        {
          category_id: 'cat_1',
          category_name: 'Spa',
          product_count: 3,
          vendor_avg_price: '100.00',
          market_avg_price: 12000,
          percentile: 70,
          position_label: 'above_average'
        }
      ]
    }
  }
];
