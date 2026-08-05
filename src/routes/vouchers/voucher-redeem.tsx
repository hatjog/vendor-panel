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
 *
 * v1.15.0 Story 5.5 (FR-10b, FR-10c, UX-DR1..UX-DR4, NFR-7, AD-17):
 *   - Stan vouchera pochodzi ze SŁOWNIKA o jednym źródle
 *     (`src/i18n/voucher-state-vocabulary.ts`, lustro kontraktu ze Story 5.1),
 *     jest ZDANIEM w języku użytkownika i nigdy nie jest surowym
 *     identyfikatorem technicznym pod `className="capitalize"`.
 *   - Każdy tekst dla użytkownika idzie przez `t()` i ma wartość w `pl.json`.
 *   - Każdy komunikat wyniku niesie SŁOWO obok koloru i ma rolę ARIA
 *     (`role="status"` / `role="alert"`), więc kolor nie jest jedynym
 *     nośnikiem znaczenia (WCAG 2.1 SC 1.4.1). Kontrast KAŻDEJ użytej pary
 *     kolor/tło jest zmierzony liczbowo w
 *     `_bmad-output/releases/v1.15.0/implementation-artifacts/evidence/5-5/contrast_check.py`.
 */

import { useState } from "react"
import { useTranslation } from "react-i18next"

import { voucherStatusI18nKey } from "../../i18n/voucher-state-vocabulary"
import { fetchQuery } from "../../lib/client/client"

type VendorVoucherView = {
  code: string
  seller_id: string
  seller_name: string
  seller_handle: string
  product_title: string
  value_minor: number
  currency_code: string
  /**
   * Świadomie `string`, nie unia literałów. Zbiór stanów jest własnością
   * kontraktu (`voucher-state-vocabulary.v1.yaml`), a nie tego pliku —
   * lokalna unia była TRZECIM słownikiem w repo i rozjeżdżała się z domeną
   * (brakowało w niej `expired`, mimo że CHECK w bazie ten stan zna).
   * Wartość spoza słownika ma zdefiniowane zachowanie: `voucherStatusI18nKey`
   * zwraca klucz sentynela i użytkownik widzi zdanie, nie identyfikator.
   */
  status: string
  market_id: string | null
  expires_at: string | null
}

type RedeemEnvelope = {
  audit_log_id: string
  vendor_id: string
  seller_id: string
  market_id: string | null
  code: string
  prior_status: string
  new_status: "claimed" | "already_claimed"
  claimed_at: string
}

/**
 * Klucze komunikatów błędu jako unia LITERAŁÓW. `i18next.d.ts` panelu typuje
 * `t()` po zbiorze istniejących kluczy, więc literówka w kluczu jest błędem
 * kompilacji, a nie cichym fallbackiem na ekranie kosmetolożki (AC2).
 */
type LookupErrorKey =
  | "voucher.redeem.error.code_too_short"
  | "voucher.redeem.error.lookup_failed"

type RedeemErrorKey =
  | "voucher.redeem.error.empty_response"
  | "voucher.redeem.error.redeem_failed"

type LookupState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; voucher: VendorVoucherView }
  | { kind: "not_found" }
  | { kind: "error"; messageKey: LookupErrorKey }

type RedeemState =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "done"
      idempotent: boolean
      envelope: RedeemEnvelope
    }
  | { kind: "error"; messageKey: RedeemErrorKey }

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
        messageKey: "voucher.redeem.error.code_too_short",
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
      // Surowy `message` z wyjątku sieciowego celowo NIE trafia na ekran:
      // jest nieprzetłumaczalny i techniczny. Nośnikiem błędu jest KLUCZ,
      // więc komunikat tłumaczy się w chwili renderu, a nie w chwili
      // złapania wyjątku — i nie da się w to miejsce wsunąć literału (AC2).
      setLookup({
        kind: "error",
        messageKey: "voucher.redeem.error.lookup_failed",
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
        setRedeem({
          kind: "error",
          messageKey: "voucher.redeem.error.empty_response",
        })
      }
    } catch {
      setRedeem({
        kind: "error",
        messageKey: "voucher.redeem.error.redeem_failed",
      })
    }
  }

  /** Zdanie w języku użytkownika dla DOWOLNEJ wartości statusu. */
  const statusLabel = (status: string) => t(voucherStatusI18nKey(status))

  return (
    <div className="mx-auto max-w-2xl p-6 text-gray-900">
      <h1 className="text-2xl font-semibold">{t("voucher.redeem.title")}</h1>
      <p className="mt-1 text-gray-600">{t("voucher.redeem.subtitle")}</p>

      <form onSubmit={onLookup} className="mt-6 flex gap-2">
        <input
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t("voucher.redeem.code_placeholder")}
          className="flex-1 rounded border border-gray-300 px-3 py-2"
          aria-label={t("voucher.redeem.code_label")}
        />
        <button
          type="submit"
          className="rounded bg-blue-700 px-4 py-2 text-white hover:bg-blue-800 disabled:opacity-50"
          disabled={lookup.kind === "loading"}
        >
          {lookup.kind === "loading"
            ? t("voucher.redeem.looking_up")
            : t("voucher.redeem.lookup")}
        </button>
      </form>

      {lookup.kind === "error" && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {t(lookup.messageKey)}
        </p>
      )}

      {lookup.kind === "not_found" && (
        <div
          role="status"
          className="mt-4 rounded border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-900"
        >
          {t("voucher.redeem.not_found")}
        </div>
      )}

      {lookup.kind === "found" && (
        <div className="mt-4 space-y-3 rounded border border-gray-200 bg-white p-4">
          <div>
            <div className="text-xs uppercase text-gray-500">
              {t("voucher.redeem.product")}
            </div>
            <div className="text-lg font-medium">
              {lookup.voucher.product_title}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs uppercase text-gray-500">
                {t("voucher.redeem.value")}
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
                {t("voucher.redeem.status")}
              </div>
              {/*
                Stan JAKO SŁOWO ze słownika. Klasa `capitalize` na surowym
                `consent_pending` dawała na ekranie „Consent_pending" — to nie
                jest zdanie w żadnym języku i nie jest to problem do naprawienia
                lepszym CSS-em (AC3).
              */}
              <div data-testid="voucher-status-label">
                {statusLabel(lookup.voucher.status)}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase text-gray-500">
                {t("voucher.redeem.code")}
              </div>
              <div className="font-mono">{lookup.voucher.code}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-gray-500">
                {t("voucher.redeem.expires_at")}
              </div>
              <div>
                {lookup.voucher.expires_at
                  ? new Date(lookup.voucher.expires_at).toLocaleString()
                  : t("voucher.redeem.no_expiry")}
              </div>
            </div>
          </div>

          {lookup.voucher.status === "claimed" && (
            <div
              role="status"
              className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-900"
            >
              {t("voucher.redeem.already_claimed")}
            </div>
          )}

          {lookup.voucher.status !== "claimed" && redeem.kind !== "done" && (
            <button
              type="button"
              onClick={onRedeem}
              disabled={redeem.kind === "loading"}
              className="rounded bg-green-800 px-4 py-2 text-white hover:bg-green-900 disabled:opacity-50"
            >
              {redeem.kind === "loading"
                ? t("voucher.redeem.redeeming")
                : t("voucher.redeem.redeem_action")}
            </button>
          )}

          {redeem.kind === "error" && (
            <p role="alert" className="text-sm text-red-700">
              {t(redeem.messageKey)}
            </p>
          )}
        </div>
      )}

      {redeem.kind === "done" && (
        <div
          role="status"
          className="mt-4 space-y-2 rounded border border-green-200 bg-green-50 p-4 text-sm text-green-900"
        >
          <div className="font-semibold">
            {redeem.idempotent
              ? t("voucher.redeem.idempotent_done")
              : t("voucher.redeem.redeemed_now")}
          </div>
          {/*
            Techniczna koperta `prior_status → new_status` znika z widoku
            użytkownika i wraca jako ZDANIE ze słownika stanów (AC2). Zostaje
            identyfikator zdarzenia audytowego — kosmetolożka podaje go
            wsparciu przy reklamacji, więc jest to informacja użytkowa,
            a nie wyciek warstwy technicznej.
            `already_claimed` NIE jest stanem vouchera, tylko znacznikiem
            idempotencji; stan końcowy jest w obu przypadkach `claimed`,
            a fakt powtórzenia niesie zdanie w nagłówku powyżej.
          */}
          <p>
            {t("voucher.redeem.transition", {
              prior: statusLabel(redeem.envelope.prior_status),
              next: statusLabel("claimed"),
            })}
          </p>
          <p>
            {t("voucher.redeem.audit_reference", {
              id: redeem.envelope.audit_log_id,
            })}
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-2 rounded border border-green-900 px-3 py-1 text-xs text-green-900 hover:bg-green-100"
          >
            {t("voucher.redeem.reset")}
          </button>
        </div>
      )}
    </div>
  )
}

export default VoucherRedeem
