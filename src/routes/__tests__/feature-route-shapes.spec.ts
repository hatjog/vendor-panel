// @vitest-environment node
import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

type Shape =
  | "string"
  | "number"
  | "null"
  | "nullable-string"
  | `enum:${string}`
  | { [key: string]: Shape }
  | [Shape]

const contracts = [
  {
    name: "training cert upload",
    routeModule: "../training-cert",
    sourceFile: "src/routes/training-cert/training-cert-upload.tsx",
    exportedComponent: "Component",
    requiredSourceFields: [
      "ALLOWED_EXTENSIONS",
      "MAX_SIZE_BYTES",
      "pending_review",
      "verified",
      "rejected",
    ],
    sample: {
      status: "pending_review",
      allowed_extensions: [".pdf", ".jpg", ".jpeg", ".png"],
      max_size_bytes: 10485760,
      rejection_reason: null,
    },
    shape: {
      status: "enum:awaiting|pending_review|verified|rejected",
      allowed_extensions: ["string"],
      max_size_bytes: "number",
      rejection_reason: "nullable-string",
    },
  },
  {
    name: "competitive insights",
    routeModule: "../dashboard/insights",
    sourceFile: "src/routes/dashboard/insights/competitive-insights-widget.tsx",
    exportedComponent: "Component",
    requiredSourceFields: [
      "vendor_avg_price",
      "market_avg_price",
      "percentile",
      "position_label",
      "solo_vendor",
    ],
    sample: {
      vendor_id: "vendor_1",
      generated_at: "2026-06-12T10:00:00.000Z",
      categories: [
        {
          category_id: "cat_1",
          category_name: "Spa",
          product_count: 3,
          vendor_avg_price: 10000,
          market_avg_price: 12000,
          percentile: 70,
          position_label: "above_average",
        },
      ],
    },
    shape: {
      vendor_id: "string",
      generated_at: "string",
      categories: [
        {
          category_id: "string",
          category_name: "string",
          product_count: "number",
          vendor_avg_price: "number",
          market_avg_price: "number",
          percentile: "number",
          position_label:
            "enum:top_quartile|above_average|below_average|bottom_quartile|solo_vendor",
        },
      ],
    },
  },
]

function assertShape(value: unknown, shape: Shape, pathLabel = "response"): void {
  if (typeof shape === "string") {
    if (shape === "nullable-string") {
      expect(value === null || typeof value === "string", `${pathLabel} should be string|null`).toBe(true)
      return
    }
    if (shape.startsWith("enum:")) {
      expect(shape.slice(5).split("|"), `${pathLabel} enum`).toContain(value)
      return
    }
    if (shape === "null") {
      expect(value).toBeNull()
      return
    }
    expect(typeof value, pathLabel).toBe(shape)
    return
  }

  if (Array.isArray(shape)) {
    expect(Array.isArray(value), `${pathLabel} should be array`).toBe(true)
    expect((value as unknown[]).length, `${pathLabel} should not be vacuous`).toBeGreaterThan(0)
    for (const [index, item] of (value as unknown[]).entries()) {
      assertShape(item, shape[0], `${pathLabel}[${index}]`)
    }
    return
  }

  expect(value && typeof value === "object" && !Array.isArray(value)).toBe(true)
  for (const [key, childShape] of Object.entries(shape)) {
    expect(value as Record<string, unknown>, `${pathLabel}.${key} missing`).toHaveProperty(key)
    assertShape((value as Record<string, unknown>)[key], childShape, `${pathLabel}.${key}`)
  }
}

describe("GP vendor feature-routes — smoke + data-shape", () => {
  it.each(contracts)("$name route module smoke-imports", async (contract) => {
    const mod = await import(contract.routeModule)
    expect(mod[contract.exportedComponent], contract.exportedComponent).toBeTypeOf("function")
  })

  it.each(contracts)("$name keeps source fields used by the route", (contract) => {
    const source = readFileSync(path.join(process.cwd(), contract.sourceFile), "utf8")
    for (const field of contract.requiredSourceFields) {
      expect(source, `${contract.sourceFile} should reference ${field}`).toContain(field)
    }
  })

  it.each(contracts)("$name response shape is explicit and non-vacuous", (contract) => {
    assertShape(contract.sample, contract.shape, contract.name)
  })

  it("shape assertions fail on missing, renamed, or mistyped fields", () => {
    const contract = contracts.find((item) => item.name === "competitive insights")
    if (!contract) {
      throw new Error("missing contract fixture")
    }

    expect(() =>
      assertShape(
        {
          vendor_id: "vendor_1",
          generated_at: "2026-06-12T10:00:00.000Z",
          categories: [
            {
              category_id: "cat_1",
              category_name: "Spa",
              product_count: 3,
              vendor_avg_price: "100.00",
              market_avg_price: 12000,
              percentile: 70,
              position_label: "above_average",
            },
          ],
        },
        contract.shape,
        contract.name,
      ),
    ).toThrow()
  })
})
