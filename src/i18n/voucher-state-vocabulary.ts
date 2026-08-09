/**
 * Lustro słownika stanów vouchera — JEDNO ŹRÓDŁO leży POZA tym submodułem.
 *
 * Źródłem prawdy jest `specs/contracts/redemption/voucher-state-vocabulary.v1.yaml`
 * w superprojekcie (AD-17, ADR-178, Story 5.1). Panel jest jego KONSUMENTEM:
 * bierze stąd zbiór stanów i **kanoniczne klucze i18n**, a NIE wymyśla własnego
 * mapowania `status → napis`.
 *
 * Dlaczego lustro, a nie import: `GP/vendor-panel` jest osobnym repozytorium
 * (submoduł) i nie może w czasie buildu czytać pliku z superprojektu. Rozjazd
 * między tym plikiem a kontraktem jest wykrywany BRAMKĄ w superprojekcie —
 * `_grow/tools/validate_vendor_panel_voucher_i18n.py` — która porównuje zbiór
 * stanów i klucze i18n z YAML-em oraz sprawdza, że każdy klucz ma niepustą
 * wartość w `pl.json` i `en.json`. Bramka degraduje się do `SKIP`, gdy submoduł
 * nie jest zaczekoutowany, i NIGDY do fałszywego `PASS`.
 *
 * Story: v1.15.0 5.5 (AC3).
 */

/** Zbiór stanów warstwy `voucher_status` — lustro `layers.voucher_status.states`. */
export const VOUCHER_STATUSES = [
  "idle",
  "consent_pending",
  "claimed",
  "withdrawn",
  "expired",
  // v1.15.0 Story 5.9 (FR-12): voucher zwrócony — kod przestaje działać razem
  // z uprawnieniem, a kosmetolożka ma prawo znać rozłączny powód odmowy.
  "refunded",
] as const

export type VoucherStatus = (typeof VOUCHER_STATUSES)[number]

/**
 * Kanoniczne klucze i18n per stan — lustro pola `i18n_key` z kontraktu.
 * NIE nadawaj tu własnych kluczy: bramka porówna je z YAML-em znak w znak.
 */
export const VOUCHER_STATUS_I18N_KEYS = {
  idle: "voucher.status.idle",
  consent_pending: "voucher.status.consent_pending",
  claimed: "voucher.status.claimed",
  withdrawn: "voucher.status.withdrawn",
  expired: "voucher.status.expired",
  refunded: "voucher.status.refunded",
} as const satisfies Record<VoucherStatus, string>

/**
 * Klucz dla wartości SPOZA słownika. To jedyny klucz stanu, którego NIE ma
 * w kontrakcie — jest sentynelem prezentacji, nie stanem domeny. Backend może
 * wyprzedzić panel o jeden deploy; wtedy użytkownik ma zobaczyć zdanie, a nie
 * surowy identyfikator techniczny (AC3).
 */
export const UNKNOWN_VOUCHER_STATUS_I18N_KEY = "voucher.status.unknown" as const

/**
 * Unia LITERAŁÓW, nie `string`. `i18next.d.ts` panelu typuje `t()` po zbiorze
 * istniejących kluczy, więc `t(someString)` się nie kompiluje — i dobrze:
 * dzięki temu literówka w kluczu stanu jest błędem typów, a nie cichym
 * fallbackiem na ekranie kosmetolożki.
 */
export type VoucherStatusI18nKey =
  | (typeof VOUCHER_STATUS_I18N_KEYS)[VoucherStatus]
  | typeof UNKNOWN_VOUCHER_STATUS_I18N_KEY

export function isVoucherStatus(value: unknown): value is VoucherStatus {
  return (
    typeof value === "string" &&
    (VOUCHER_STATUSES as readonly string[]).includes(value)
  )
}

/** Zwraca klucz i18n dla dowolnej wartości statusu (znanej lub nie). */
export function voucherStatusI18nKey(
  status: string | null | undefined,
): VoucherStatusI18nKey {
  return isVoucherStatus(status)
    ? VOUCHER_STATUS_I18N_KEYS[status]
    : UNKNOWN_VOUCHER_STATUS_I18N_KEY
}
