/**
 * Odmowa realizacji vouchera — rozpoznanie powodu i zdanie dla sprzedawczyni
 * (v1.16.0 Story 5.5: FR-19, AD-34; ADR-219 §4 człon 3, DW-15-210;
 * ADR-243 `Proposed`).
 *
 * Wydzielone z `voucher-redeem.tsx`, żeby linie call-site'ów ekranu zostały
 * bez zmian (inwentarz tras Story 5.1 jest kotwiczony liniami i nie jest
 * regenerowany — DW-15-294).
 */

import {
  ENTITLEMENT_REFUSAL_I18N_KEYS,
  REDEEM_REFUSAL_I18N_KEYS,
  type EntitlementRefusalReason,
  type RedeemRefusalReason as RefusalReason,
} from "../../i18n/voucher-state-vocabulary"
import {
  VoucherApiError,
  type VoucherRedemptionFact,
} from "../../lib/client/voucher-client"

export type { VoucherRedemptionFact }

/**
 * Odmowa rozpoznana przez panel. Trzy osie:
 *   - `voucher`     — powód stanu vouchera z kontraktu v3 (ADR-209),
 *   - `entitlement` — powód stanu uprawnienia (`REDEMPTION_REFUSED`, AC3),
 *   - `unknown`     — serwer przysłał maszynowy `reason`, którego ten build
 *                     panelu nie zna (backend wyprzedza panel o deploy).
 *                     Ekran pokazuje wtedy BEZPIECZNY wariant domyślny, a nie
 *                     surowy klucz, pusty blok ani „spróbuj ponownie” (AC2).
 */
export type PanelRefusal =
  | { axis: "voucher"; reason: RefusalReason }
  | { axis: "entitlement"; reason: EntitlementRefusalReason }
  | { axis: "unknown"; reason: string }

/**
 * `null` = to nie jest odmowa z maszynowym powodem (błąd sieci, 5xx, odmowa
 * bez `reason`) — ekran zostaje przy ogólnym komunikacie błędu.
 */
export function refusalFromError(
  error: unknown,
): { refusal: PanelRefusal; redemption: VoucherRedemptionFact | null } | null {
  if (!(error instanceof VoucherApiError)) return null
  const reason = error.reason
  if (!reason) return null
  const redemption = error.redemption
  if (Object.prototype.hasOwnProperty.call(REDEEM_REFUSAL_I18N_KEYS, reason)) {
    return {
      refusal: { axis: "voucher", reason: reason as RefusalReason },
      redemption,
    }
  }
  if (Object.prototype.hasOwnProperty.call(ENTITLEMENT_REFUSAL_I18N_KEYS, reason)) {
    return {
      refusal: { axis: "entitlement", reason: reason as EntitlementRefusalReason },
      redemption,
    }
  }
  return { refusal: { axis: "unknown", reason }, redemption }
}

/**
 * Bezpieczne zdania domyślne ZASZYTE W KODZIE (AC2). Używane, gdy klucza
 * brakuje w przestrzeni nazw (albo i18n zwraca sam klucz lub sentynel braku)
 * — odmowa nigdy nie staje się surowym kluczem ani pustym ekranem.
 */
const REFUSAL_FALLBACK: Record<RefusalReason | EntitlementRefusalReason, string> = {
  already_redeemed: "Ten voucher został już zrealizowany wcześniej. Nie realizujemy go drugi raz.",
  withdrawn: "Ten voucher został wycofany i nie można go zrealizować.",
  expired: "Ten voucher wygasł i nie można go zrealizować.",
  refunded: "Ten voucher został zwrócony, więc nie można go zrealizować.",
  not_redeemable:
    "Stan tego vouchera nie pozwala na realizację. Zgłoś to wsparciu, podając kod vouchera.",
  not_yet_active: "Ten voucher nie jest jeszcze aktywny, więc nie można go zrealizować.",
}

export const UNKNOWN_REFUSAL_FALLBACK =
  "Nie można zrealizować tego vouchera. Nie wykonuj zabiegu — sprawdź kod ponownie albo zgłoś to wsparciu, podając kod vouchera."

const REDEEMED_DETAIL_FALLBACK =
  "Ten voucher został już zrealizowany {{when}} przez {{by}}. Nie realizujemy go drugi raz."
const REDEEMED_WHEN_FALLBACK =
  "Ten voucher został już zrealizowany {{when}}. Nie realizujemy go drugi raz."
const REDEEMED_BY_OWN_SELLER_FALLBACK = "Twój salon"

type LooseT = (key: string, options?: Record<string, unknown>) => unknown

function interpolate(template: string, values?: Record<string, string>): string {
  if (!values) return template
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, name: string) =>
    name in values ? values[name] : m,
  )
}

/**
 * `t()` z gwarancją niepustego zdania: brak klucza, wartość pusta, zwrócony
 * sam klucz albo sentynel braku ⇒ zdanie domyślne z kodu. Wyjątek i18n też
 * kończy się zdaniem domyślnym (skutek nazwany, nie cichy — NFR-4).
 */
export function safeTranslate(
  t: LooseT,
  key: string,
  fallback: string,
  values?: Record<string, string>,
): string {
  let out: unknown
  try {
    out = t(key, { ...(values ?? {}), defaultValue: interpolate(fallback, values) })
  } catch {
    return interpolate(fallback, values)
  }
  if (
    typeof out !== "string" ||
    !out.trim() ||
    out.includes(key) ||
    out.includes("__MISSING__")
  ) {
    return interpolate(fallback, values)
  }
  return out
}

/** Zdanie odmowy: powód z osi + fakt realizacji („kiedy i przez kogo”, AC1). */
export function buildRefusalSentence(
  t: LooseT,
  formatWhen: (iso: string) => string,
  refusal: PanelRefusal,
  redemption: VoucherRedemptionFact | null,
): string {
  if (refusal.axis === "unknown") {
    return safeTranslate(t, "voucher.redeem.refused.unknown", UNKNOWN_REFUSAL_FALLBACK)
  }
  if (refusal.axis === "entitlement") {
    return safeTranslate(
      t,
      ENTITLEMENT_REFUSAL_I18N_KEYS[refusal.reason],
      REFUSAL_FALLBACK[refusal.reason],
    )
  }
  if (refusal.reason === "already_redeemed" && redemption?.redeemed_at) {
    const when = formatWhen(redemption.redeemed_at)
    if (redemption.redeemed_by === "own_seller") {
      const by = safeTranslate(
        t,
        "voucher.redeem.refused.redeemed_by_own_seller",
        REDEEMED_BY_OWN_SELLER_FALLBACK,
      )
      return safeTranslate(
        t,
        "voucher.redeem.refused.already_redeemed_detail",
        REDEEMED_DETAIL_FALLBACK,
        { when, by },
      )
    }
    return safeTranslate(
      t,
      "voucher.redeem.refused.already_redeemed_when",
      REDEEMED_WHEN_FALLBACK,
      { when },
    )
  }
  return safeTranslate(
    t,
    REDEEM_REFUSAL_I18N_KEYS[refusal.reason],
    REFUSAL_FALLBACK[refusal.reason],
  )
}
