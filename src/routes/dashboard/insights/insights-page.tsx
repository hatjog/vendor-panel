/**
 * Story v160-7-7: Vendor insights dashboard route page.
 */

import CompetitiveInsightsWidget from "./competitive-insights-widget"

export const InsightsPage = () => {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <CompetitiveInsightsWidget />
    </div>
  )
}

export default InsightsPage
