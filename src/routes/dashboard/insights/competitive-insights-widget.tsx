/**
 * Story v160-7-7: Vendor competitive insights widget (vendor-panel).
 *
 * Per-category metrics: vendor avg price, market avg, percentile rank, position
 * label. Privacy-preserving: zero competitor PII (only aggregates).
 */

import { useEffect, useState } from "react"

type PositionLabel =
  | "top_quartile"
  | "above_average"
  | "below_average"
  | "bottom_quartile"
  | "solo_vendor"

interface CategoryInsight {
  category_id: string
  category_name: string
  product_count: number
  vendor_avg_price: number
  market_avg_price: number
  percentile: number | null
  position_label: PositionLabel
}

interface InsightsData {
  vendor_id: string
  generated_at: string
  categories: CategoryInsight[]
}

const LABEL_COPY: Record<PositionLabel, string> = {
  top_quartile: "Top 25%",
  above_average: "Above average",
  below_average: "Below average",
  bottom_quartile: "Bottom 25%",
  solo_vendor: "Solo vendor",
}

const LABEL_COLOR: Record<PositionLabel, string> = {
  top_quartile: "bg-blue-100 text-blue-800",
  above_average: "bg-green-100 text-green-800",
  below_average: "bg-yellow-100 text-yellow-800",
  bottom_quartile: "bg-red-100 text-red-800",
  solo_vendor: "bg-gray-100 text-gray-800",
}

function formatCurrency(amount: number, currency = "PLN"): string {
  return `${(amount / 100).toFixed(2)} ${currency}`
}

export const CompetitiveInsightsWidget = () => {
  const [data, setData] = useState<InsightsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/vendor/competitive-insights", {
        credentials: "include",
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const json = (await res.json()) as InsightsData
      setData(json)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchData()
  }, [])

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Competitive Insights</h2>
          <p className="text-sm text-gray-600">
            How your pricing compares (privacy-preserving aggregates only).
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchData()}
          disabled={loading}
          className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Error: {error}
          <button
            type="button"
            onClick={() => void fetchData()}
            className="ml-2 underline"
          >
            Retry
          </button>
        </div>
      )}

      {!error && data && data.categories.length === 0 && (
        <div className="rounded border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
          No products yet — add products to see competitive insights.
        </div>
      )}

      {!error && data && data.categories.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {data.categories.map((cat) => (
            <div
              key={cat.category_id}
              className="rounded border border-gray-200 p-4"
            >
              <div className="flex items-baseline justify-between">
                <h3 className="font-medium">{cat.category_name}</h3>
                <span className="text-xs text-gray-500">
                  {cat.product_count} product{cat.product_count !== 1 && "s"}
                </span>
              </div>
              <div className="mt-2">
                <div className="text-2xl font-semibold">
                  {formatCurrency(cat.vendor_avg_price)}
                </div>
                {cat.position_label !== "solo_vendor" && (
                  <div className="mt-1 text-sm text-gray-600">
                    Market avg: {formatCurrency(cat.market_avg_price)}
                  </div>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <span
                    className={`inline-block rounded px-2 py-0.5 text-xs ${LABEL_COLOR[cat.position_label]}`}
                  >
                    {LABEL_COPY[cat.position_label]}
                  </span>
                  {cat.percentile !== null && (
                    <span className="text-xs text-gray-500">
                      {cat.percentile}
                      {"th percentile"}
                    </span>
                  )}
                </div>
                {cat.percentile !== null && (
                  <div className="mt-2 h-2 rounded bg-gray-200">
                    <div
                      className="h-2 rounded bg-blue-500"
                      style={{ width: `${cat.percentile}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {data && (
        <p className="mt-3 text-xs text-gray-500">
          Last updated:{" "}
          {new Date(data.generated_at).toLocaleString()}
        </p>
      )}
    </div>
  )
}

export default CompetitiveInsightsWidget
