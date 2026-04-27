import { Container, Heading, Text } from "@medusajs/ui"
import { useTranslation } from "react-i18next"

import { StoreVendor } from "../../../../../types/user"
import { ImageAvatar } from "../../../../../components/common/image-avatar"
import { LockedFieldGroup } from "../../../../../components/common/locked-field-group"

/**
 * Read-only "details" rows shared by every locked group in the store profile
 * preview. Renders label + value with a consistent grid layout that matches
 * pre-existing styling in admin sections.
 */
const LockedFieldRow = ({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) => (
  <div className="text-ui-fg-subtle grid grid-cols-2 px-6 py-4 items-center">
    <Text size="small" leading="compact" weight="plus">
      {label}
    </Text>
    <Text size="small" leading="compact">
      {value ?? "-"}
    </Text>
  </div>
)

const NotConfiguredYet = ({ label }: { label: string }) => (
  <div className="text-ui-fg-muted px-6 py-4">
    <Text size="small" leading="compact">
      {label}
    </Text>
  </div>
)

/**
 * `StoreGeneralSection` renders the vendor store profile as a read-only
 * preview (D-33: vendor data is config-authoritative; v1.5.0 self-service
 * unlocks editing). Locked fields are organised into 5 groups per
 * STORY-VENDOR-PANEL-LOCK-UI AC #1; every group renders a single lock icon
 * with an action-forward tooltip (AC #2/#3) pointing vendors at the
 * `vendor@bonbeauty.pl` channel + 24h SLA.
 */
export const StoreGeneralSection = ({ seller }: { seller: StoreVendor }) => {
  const { t } = useTranslation()

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading>{t("store.domain")}</Heading>
        </div>
      </div>

      {/* Group 1 — Informacje podstawowe (name, handle, description, photo) */}
      <LockedFieldGroup groupKey="basicInfo">
        <LockedFieldRow
          label="Image"
          value={<ImageAvatar src={seller.photo || "/logo.svg"} size={8} rounded />}
        />
        <LockedFieldRow label={t("fields.name")} value={seller.name} />
        {seller.handle !== undefined && (
          <LockedFieldRow label="Handle" value={seller.handle} />
        )}
        <LockedFieldRow label="Description" value={seller.description || "-"} />
      </LockedFieldGroup>

      {/* Group 2 — Galeria (image array; not yet on StoreVendor — preview only) */}
      <LockedFieldGroup groupKey="gallery">
        <NotConfiguredYet
          label={t("vendorPanel.lockedField.tooltip")}
        />
      </LockedFieldGroup>

      {/* Group 3 — Lokalizacje i kontakty (address fields, contact email/phone) */}
      <LockedFieldGroup groupKey="locationsAndContacts">
        <LockedFieldRow label={t("fields.email")} value={seller.email} />
        <LockedFieldRow label={t("fields.phone")} value={seller.phone} />
        {seller.address_line && (
          <LockedFieldRow label="Address" value={seller.address_line} />
        )}
        {seller.city && <LockedFieldRow label="City" value={seller.city} />}
        {seller.postal_code && (
          <LockedFieldRow label="Postal code" value={seller.postal_code} />
        )}
        {seller.country_code && (
          <LockedFieldRow label="Country" value={seller.country_code} />
        )}
      </LockedFieldGroup>

      {/* Group 4 — Social media (not yet on StoreVendor — preview only) */}
      <LockedFieldGroup groupKey="socialMedia">
        <NotConfiguredYet
          label={t("vendorPanel.lockedField.tooltip")}
        />
      </LockedFieldGroup>

      {/* Group 5 — SEO (not yet on StoreVendor — preview only) */}
      <LockedFieldGroup groupKey="seo">
        <NotConfiguredYet
          label={t("vendorPanel.lockedField.tooltip")}
        />
      </LockedFieldGroup>
    </Container>
  )
}
