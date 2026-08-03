import { LockClosedSolid } from "@medusajs/icons"
import { Tooltip, Heading, Text, clx } from "@medusajs/ui"
import { ReactNode, useId } from "react"
import { useTranslation } from "react-i18next"

/**
 * Translation key path under `vendorPanel.lockedField.groups` that names the
 * group of locked fields rendered inside this section.
 *
 * v1.4.0 vendor panel = read-only preview (D-33). v1.5.0 self-service will
 * unlock these groups; the tooltip names the channel + SLA so vendors know
 * how to request changes today.
 */
export type LockedFieldGroupKey =
  | "basicInfo"
  | "gallery"
  | "locationsAndContacts"
  | "socialMedia"
  | "seo"

type LockedFieldGroupProps = {
  /**
   * i18n key (suffix under `vendorPanel.lockedField.groups`) identifying the
   * field-group label rendered in the section header.
   */
  groupKey: LockedFieldGroupKey
  /**
   * The locked field rows (or any custom read-only content) to render below
   * the group header.
   */
  children: ReactNode
  /**
   * Optional className appended to the outer wrapper for layout adjustments.
   */
  className?: string
}

/**
 * `LockedFieldGroup` renders a single lock icon + tooltip for a group of
 * vendor-panel fields that are read-only in v1.4.0 (per D-33: vendor data is
 * config-authoritative; vendor panel is preview only).
 *
 * AC compliance:
 * - AC #2: ONE lock icon per group (no per-field icons inside `children`).
 * - AC #3: tooltip with primary action-forward line + clickable `mailto:`
 *   secondary line; `role="tooltip"` (provided by Medusa Tooltip) +
 *   `aria-describedby` linkage; dismissible by Esc / blur via Radix Tooltip.
 * - AC #5: read-only state = caller renders `<Text>` rows (not editable
 *   inputs) — this component does not own form state.
 * - AC #6: consistent styling — same icon size/colour/typography across all
 *   five group instances.
 */
export const LockedFieldGroup = ({
  groupKey,
  children,
  className,
}: LockedFieldGroupProps) => {
  const { t } = useTranslation()
  const tooltipId = useId()

  const groupName = t(`vendorPanel.lockedField.groups.${groupKey}`)
  const headerText = t("vendorPanel.lockedField.groupHeader", {
    name: groupName,
  })
  const ariaLabel = t("vendorPanel.lockedField.ariaLabel", { name: groupName })
  const tooltipText = t("vendorPanel.lockedField.tooltip")
  const tooltipEmail = t("vendorPanel.lockedField.tooltipEmail")

  const tooltipContent = (
    <div className="flex flex-col gap-y-1.5 max-w-xs">
      <Text size="small" leading="compact" className="text-ui-fg-base">
        {tooltipText}
      </Text>
      <a
        href={`mailto:${tooltipEmail}`}
        className="text-ui-fg-interactive hover:text-ui-fg-interactive-hover text-xs underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-fg-interactive rounded-sm"
      >
        {tooltipEmail}
      </a>
    </div>
  )

  return (
    <div className={clx("flex flex-col", className)} aria-describedby={tooltipId}>
      <Tooltip content={tooltipContent} delayDuration={150}>
        <div
          tabIndex={0}
          role="group"
          aria-label={ariaLabel}
          aria-describedby={tooltipId}
          id={tooltipId}
          className="flex items-center gap-x-2 px-6 py-3 bg-ui-bg-subtle border-b border-ui-border-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-fg-interactive focus-visible:ring-offset-1 cursor-help"
        >
          <LockClosedSolid
            className="text-ui-fg-muted shrink-0"
            aria-hidden="true"
          />
          <Heading
            level="h3"
            className="text-ui-fg-subtle text-sm font-medium"
          >
            {headerText}
          </Heading>
        </div>
      </Tooltip>
      <div className="divide-y">{children}</div>
    </div>
  )
}
