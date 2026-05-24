/**
 * Vendor-panel — voucher lookup + redeem page.
 *
 * cc-4 finding F-05: Story 8.4 cross-actor handoff required a real
 * vendor-facing UI for voucher redemption. The previous version had
 * only the harness contract — no in-app affordance for the salon user.
 *
 * Flow:
 *   1. Salon user enters the recipient's voucher code (printed/emailed).
 *   2. UI calls GET  /vendor/vouchers/:code/lookup → 404 (unknown / wrong
 *      vendor) or 200 with the public voucher view (product, value,
 *      expiry, status).
 *   3. If status is `idle`, salon user clicks "Mark as redeemed" which
 *      calls POST /vendor/vouchers/:code/redeem and renders the
 *      8-key audit envelope. Already-claimed vouchers return 200 with
 *      idempotent=true and surface as "already redeemed".
 *
 * Auth: requests carry the existing vendor-panel session (Mercur cookie /
 * publishable key) via `fetchQuery`. The backend route is HMAC-gated
 * via `withVendorAuth`; a future iteration will inject the HMAC signer
 * inside `fetchQuery` so this UI works against the GP S2S surface (the
 * v1.9.0 baseline relies on the existing Mercur seller session for
 * local-dev parity — see CC-4 F-14 for the matching audit task).
 */

import { useState } from "react"
import { useTranslation } from "react-i18next"

import { fetchQuery } from "../../lib/client/client"

type VendorVoucherView = {
  code: string
  seller_id: string
  seller_name: string
  seller_handle: string
  product_title: string
  value_minor: number
  currency_code: string
  status: "idle" | "consent_pending" | "claimed" | "withdrawn"
  market_id: string | null
  expires_at: string | null
}

type RedeemEnvelope = {
  audit_log_id: string
  vendor_id: string
  seller_id: string
  market_id: string | null
  code: string
  prior_status: VendorVoucherView["status"]
  new_status: "claimed" | "already_claimed"
  claimed_at: string
}

type LookupState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; voucher: VendorVoucherView }
  | { kind: "not_found" }
  | { kind: "error"; message: string }

type RedeemState =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "done"
      idempotent: boolean
      envelope: RedeemEnvelope
    }
  | { kind: "error"; message: string }

function formatMoney(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(minor / 100)
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`
  }
}

export const VoucherRedeem = () => {
  const { t } = useTranslation()
  const [code, setCode] = useState("")
  const [lookup, setLookup] = useState<LookupState>({ kind: "idle" })
  const [redeem, setRedeem] = useState<RedeemState>({ kind: "idle" })

  const reset = () => {
    setLookup({ kind: "idle" })
    setRedeem({ kind: "idle" })
  }

  const onLookup = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = code.trim()
    if (trimmed.length < 3) {
      setLookup({
        kind: "error",
        message: t(
          "vendor.voucher.code_too_short",
          "Code is required (min 3 chars)",
        ),
      })
      return
    }
    setLookup({ kind: "loading" })
    setRedeem({ kind: "idle" })
    try {
      const data = await fetchQuery(
        `/vendor/vouchers/${encodeURIComponent(trimmed)}/lookup`,
        { method: "GET" },
      )
      if (data?.voucher) {
        setLookup({ kind: "found", voucher: data.voucher })
      } else {
        setLookup({ kind: "not_found" })
      }
    } catch (err) {
      const status = (err as { status?: number })?.status
      if (status === 404) {
        setLookup({ kind: "not_found" })
        return
      }
      setLookup({
        kind: "error",
        message: (err as Error)?.message ?? "Lookup failed",
      })
    }
  }

  const onRedeem = async () => {
    if (lookup.kind !== "found") return
    setRedeem({ kind: "loading" })
    try {
      const data = await fetchQuery(
        `/vendor/vouchers/${encodeURIComponent(
          lookup.voucher.code,
        )}/redeem`,
        { method: "POST" },
      )
      if (data?.envelope) {
        setRedeem({
          kind: "done",
          idempotent: Boolean(data.idempotent),
          envelope: data.envelope as RedeemEnvelope,
        })
      } else {
        setRedeem({ kind: "error", message: "Empty response" })
      }
    } catch (err) {
      setRedeem({
        kind: "error",
        message: (err as Error)?.message ?? "Redeem failed",
      })
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">
        {t("vendor.voucher.title", "Redeem voucher")}
      </h1>
      <p className="mt-1 text-gray-600">
        {t(
          "vendor.voucher.subtitle",
          "Enter the recipient's voucher code to verify and mark it as redeemed.",
        )}
      </p>

      <form onSubmit={onLookup} className="mt-6 flex gap-2">
        <input
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t("vendor.voucher.code_placeholder", "Voucher code")}
          className="flex-1 rounded border border-gray-300 px-3 py-2"
          aria-label={t("vendor.voucher.code_label", "Voucher code")}
        />
        <button
          type="submit"
          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          disabled={lookup.kind === "loading"}
        >
          {lookup.kind === "loading"
            ? t("vendor.voucher.looking_up", "Looking up…")
            : t("vendor.voucher.lookup", "Look up")}
        </button>
      </form>

      {lookup.kind === "error" && (
        <p className="mt-2 text-sm text-red-600">{lookup.message}</p>
      )}

      {lookup.kind === "not_found" && (
        <div className="mt-4 rounded border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900">
          {t(
            "vendor.voucher.not_found",
            "Voucher not found. Double-check the code or ask the recipient to forward the email.",
          )}
        </div>
      )}

      {lookup.kind === "found" && (
        <div className="mt-4 space-y-3 rounded border border-gray-200 bg-white p-4">
          <div>
            <div className="text-xs uppercase text-gray-500">
              {t("vendor.voucher.product", "Product")}
            </div>
            <div className="text-lg font-medium">
              {lookup.voucher.product_title}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs uppercase text-gray-500">
                {t("vendor.voucher.value", "Value")}
              </div>
              <div>
                {formatMoney(
                  lookup.voucher.value_minor,
                  lookup.voucher.currency_code,
                )}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase text-gray-500">
                {t("vendor.voucher.status", "Status")}
              </div>
              <div className="capitalize">{lookup.voucher.status}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-gray-500">
                {t("vendor.voucher.code", "Code")}
              </div>
              <div className="font-mono">{lookup.voucher.code}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-gray-500">
                {t("vendor.voucher.expires_at", "Expires")}
              </div>
              <div>
                {lookup.voucher.expires_at
                  ? new Date(lookup.voucher.expires_at).toLocaleString()
                  : t("vendor.voucher.no_expiry", "No expiry")}
              </div>
            </div>
          </div>

          {lookup.voucher.status === "claimed" && (
            <div className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              {t(
                "vendor.voucher.already_claimed",
                "This voucher is already marked as redeemed.",
              )}
            </div>
          )}

          {lookup.voucher.status !== "claimed" && redeem.kind !== "done" && (
            <button
              type="button"
              onClick={onRedeem}
              disabled={redeem.kind === "loading"}
              className="rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
            >
              {redeem.kind === "loading"
                ? t("vendor.voucher.redeeming", "Redeeming…")
                : t("vendor.voucher.redeem_action", "Mark as redeemed")}
            </button>
          )}

          {redeem.kind === "error" && (
            <p className="text-sm text-red-600">{redeem.message}</p>
          )}
        </div>
      )}

      {redeem.kind === "done" && (
        <div className="mt-4 space-y-2 rounded border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          <div className="font-semibold">
            {redeem.idempotent
              ? t(
                  "vendor.voucher.idempotent_done",
                  "Voucher was already redeemed earlier.",
                )
              : t(
                  "vendor.voucher.redeemed_now",
                  "Voucher marked as redeemed.",
                )}
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-green-800">audit_log_id</dt>
            <dd className="font-mono">{redeem.envelope.audit_log_id}</dd>
            <dt className="text-green-800">code</dt>
            <dd className="font-mono">{redeem.envelope.code}</dd>
            <dt className="text-green-800">market_id</dt>
            <dd>{redeem.envelope.market_id ?? "—"}</dd>
            <dt className="text-green-800">prior_status → new_status</dt>
            <dd>
              {redeem.envelope.prior_status} → {redeem.envelope.new_status}
            </dd>
            <dt className="text-green-800">claimed_at</dt>
            <dd>{new Date(redeem.envelope.claimed_at).toLocaleString()}</dd>
          </dl>
          <button
            type="button"
            onClick={reset}
            className="mt-2 rounded border border-green-700 px-3 py-1 text-xs text-green-800 hover:bg-green-100"
          >
            {t("vendor.voucher.reset", "Look up another voucher")}
          </button>
        </div>
      )}
    </div>
  )
}

export default VoucherRedeem
