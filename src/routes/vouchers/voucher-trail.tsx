/**
 * Ślad realizacji po kodzie vouchera i korekta pomyłkowej realizacji
 * (v1.16.0 Story 5.7: FR-19a, AD-34; decyzja PO D-36; ADR-245 `Proposed`).
 *
 * Wydzielone z `voucher-redeem.tsx`, żeby linie call-site'ów ekranu zostały
 * bez zmian (inwentarz tras Story 5.1 jest kotwiczony liniami — DW-15-294).
 *
 *   - ślad pochodzi z `GET /vendor/vouchers/:code/lookup` (`redemption_trail`):
 *     moment, aktor (poziom salonu) i rynek — bez identyfikatorów wewnętrznych;
 *   - korekta woła `POST /vendor/vouchers/:code/reverse-redemption` z sesją
 *     sprzedawcy (`x-seller-id`); odmowa ma zdanie z klucza i18n, nie surowy
 *     `message` serwera.
 */

import { useState } from "react"
import { useTranslation } from "react-i18next"

import { VoucherApiError, voucherFetch } from "../../lib/client/voucher-client"

export type RedemptionTrailEntry = {
  kind: "redemption" | "correction" | "refund_reversal" | string
  at: string
  actor: "own_seller" | null | string
  market_id: string
}

/** Bezpieczny odczyt `redemption_trail` z odpowiedzi lookupu. */
export function readRedemptionTrail(raw: unknown): RedemptionTrailEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    const e = entry as Record<string, unknown> | null
    if (!e || typeof e.at !== "string" || typeof e.kind !== "string") return []
    return [
      {
        kind: e.kind,
        at: e.at,
        actor: typeof e.actor === "string" ? e.actor : null,
        market_id: typeof e.market_id === "string" ? e.market_id : "",
      },
    ]
  })
}

/** Korekta dostępna, gdy OSTATNI wpis śladu jest realizacją. */
export function canCorrect(trail: RedemptionTrailEntry[], status: string): boolean {
  return status === "claimed" && trail.length > 0 && trail[trail.length - 1].kind === "redemption"
}

type CorrectionRefusal = "already_reversed" | "not_redeemed" | "not_correctable"

const CORRECTION_REFUSAL_KEYS = {
  already_reversed: "voucher.redeem.correction_refused.already_reversed",
  not_redeemed: "voucher.redeem.correction_refused.not_redeemed",
  not_correctable: "voucher.redeem.correction_refused.not_correctable",
} as const

type CorrectionState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done" }
  | { kind: "refused"; reason: CorrectionRefusal }
  | { kind: "error" }

export const VoucherRedemptionTrail = ({
  code,
  sellerId,
  status,
  trail,
  formatWhen,
  onCorrected,
}: {
  code: string
  sellerId: string
  status: string
  trail: RedemptionTrailEntry[]
  formatWhen: (iso: string) => string
  /**
   * `voucherStatus` = stan kodu przywrócony przez backend (`voucher_status`
   * z odpowiedzi 200: `idle` albo `consent_pending`); `null`, gdy odpowiedź
   * go nie niesie — wtedy ekran NIE zgaduje (runda fix 1, LOW panel).
   */
  onCorrected: (entry: RedemptionTrailEntry, voucherStatus: string | null) => void
}) => {
  const { t } = useTranslation()
  const [state, setState] = useState<CorrectionState>({ kind: "idle" })

  const kindLabel = (kind: string) =>
    kind === "correction"
      ? t("voucher.redeem.trail_correction")
      : kind === "refund_reversal"
        ? t("voucher.redeem.trail_refund_reversal")
        : t("voucher.redeem.trail_redemption")

  const onCorrect = async () => {
    setState({ kind: "running" })
    try {
      const data = await voucherFetch(
        `/vendor/vouchers/${encodeURIComponent(code)}/reverse-redemption`,
        { method: "POST", sellerId },
      )
      const correction = (data?.correction ?? {}) as Record<string, unknown>
      setState({ kind: "done" })
      onCorrected(
        {
          kind: "correction",
          at: typeof correction.corrected_at === "string" ? correction.corrected_at : new Date().toISOString(),
          actor: "own_seller",
          market_id: typeof correction.market_id === "string" ? correction.market_id : "",
        },
        typeof data?.voucher_status === "string" ? data.voucher_status : null,
      )
    } catch (err) {
      const reason = err instanceof VoucherApiError ? err.reason : null
      if (reason && Object.prototype.hasOwnProperty.call(CORRECTION_REFUSAL_KEYS, reason)) {
        setState({ kind: "refused", reason: reason as CorrectionRefusal })
        return
      }
      setState({ kind: "error" })
    }
  }

  if (trail.length === 0 && state.kind !== "done") return null

  return (
    <div data-testid="voucher-redemption-trail" className="space-y-2">
      <div className="text-xs uppercase text-gray-500">{t("voucher.redeem.trail_title")}</div>
      <ul className="space-y-1 text-sm">
        {trail.map((entry, index) => (
          <li key={`${entry.at}-${index}`} data-testid="voucher-trail-entry">
            {t("voucher.redeem.trail_entry", {
              kind: kindLabel(entry.kind),
              when: formatWhen(entry.at),
              actor:
                entry.actor === "own_seller"
                  ? t("voucher.redeem.trail_actor_own_seller")
                  : t("voucher.redeem.trail_actor_unknown"),
              market: entry.market_id,
            })}
          </li>
        ))}
      </ul>
      {state.kind === "done" && (
        <p role="status" data-testid="voucher-correction-done" className="text-sm text-green-900">
          {t("voucher.redeem.corrected")}
        </p>
      )}
      {state.kind === "refused" && (
        <p role="alert" data-testid="voucher-correction-refusal" className="text-sm text-red-700">
          {t(CORRECTION_REFUSAL_KEYS[state.reason])}
        </p>
      )}
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-red-700">
          {t("voucher.redeem.correction_failed")}
        </p>
      )}
      {canCorrect(trail, status) && state.kind !== "done" && (
        <button
          type="button"
          data-testid="voucher-correct-action"
          onClick={onCorrect}
          disabled={state.kind === "running"}
          className="min-h-[44px] w-full rounded border border-gray-300 px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {state.kind === "running" ? t("voucher.redeem.correcting") : t("voucher.redeem.correct_action")}
        </button>
      )}
    </div>
  )
}
