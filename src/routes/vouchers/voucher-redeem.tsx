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
 *
 * v1.15.0 Story 5.6 (FR-10c, UX-DR5..UX-DR7, UX-DR11, NFR-7, AD-25):
 *   - Layout jest MOBILE-FIRST: wariant bezprefiksowy to wariant telefonu
 *     (jedna kolumna, pełna szerokość, `p-4`), a szersze ekrany dostają
 *     wariant przez breakpoint `sm:` — nie odwrotnie.
 *   - Główny przycisk realizacji NIE leży wewnątrz karty metryk, tylko
 *     w dolnej strefie ekranu (`sticky bottom-0` na telefonie), w zasięgu
 *     kciuka jednej ręki (UX-DR6).
 *   - KAŻDY element interaktywny ma cel dotykowy >= 44x44 px wymuszony
 *     klasą (`min-h-[44px]` + `w-full`/`min-w-[44px]`), nie „wyjściem
 *     z paddingu”, oraz widoczny wskaźnik focusu (`focus-visible:outline-*`).
 *     Mierzy to bramka `_grow/tools/validate_vendor_panel_voucher_touch_targets.py`,
 *     która czyta TE KLASY; kontrast pierścienia mierzy bramka kontrastu.
 *   - Potwierdzenie mówi CO i KIEDY po polsku na pierwszym planie, a pełna
 *     koperta audytowa SCHODZI pod `<details>` — zejście, nie wycięcie
 *     (UX-DR11). Surowe identyfikatory żyją wyłącznie w tej kopercie.
 */

import { useEffect, useRef, useState } from "react"
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
      /**
       * Story 5.6 (AC4): potwierdzenie musi powiedzieć CO zrealizowano, a
       * koperta odpowiedzi zna wyłącznie `code`. Widok vouchera jest więc
       * ZATRZYMYWANY w stanie potwierdzenia — inaczej nazwa usługi i wartość
       * znikają z ekranu razem z kartą lookupu i kosmetolożka dostaje sam
       * identyfikator zdarzenia audytowego.
       */
      voucher: VendorVoucherView
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

/**
 * `claimed_at` dla CZŁOWIEKA — data i godzina w języku interfejsu, nie ISO-8601
 * (AC4). Techniczna forma ISO zostaje, ale schodzi do koperty pod „Szczegóły”.
 */
function formatWhen(iso: string, language: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    // Niepoprawna data z serwera NIE może wyprodukować „Invalid Date” na
    // ekranie kosmetolożki; surowa wartość jest wtedy uczciwsza niż sentynel
    // biblioteki, a koperta pod „Szczegóły” niesie ją i tak.
    return iso
  }
  try {
    return new Intl.DateTimeFormat(language, {
      dateStyle: "long",
      timeStyle: "short",
    }).format(date)
  } catch {
    return date.toLocaleString(language)
  }
}

export const VoucherRedeem = () => {
  const { t, i18n } = useTranslation()
  const [code, setCode] = useState("")
  const [lookup, setLookup] = useState<LookupState>({ kind: "idle" })
  const [redeem, setRedeem] = useState<RedeemState>({ kind: "idle" })
  const confirmationRef = useRef<HTMLDivElement | null>(null)

  /**
   * AC3: po realizacji focus przechodzi NA POTWIERDZENIE. Bez tego kciuk
   * dotyka przycisku, a klawiatura i czytnik ekranu zostają w miejscu, którego
   * już nie ma na ekranie (karta lookupu znika).
   */
  useEffect(() => {
    if (redeem.kind === "done") {
      confirmationRef.current?.focus()
    }
  }, [redeem.kind])

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
          voucher: lookup.voucher,
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
    // MOBILE-FIRST: `p-4` i `w-full` to warianty TELEFONU; `sm:` podnosi je do
    // desktopu. Odwrotna kolejność (desktop domyślnie + `sm:` na telefon)
    // byłaby nadal layoutem desktopowym z dopisanym prefiksem (AC1).
    <div className="mx-auto max-w-2xl p-4 text-gray-900 sm:p-6">
      <h1 className="text-2xl font-semibold">{t("voucher.redeem.title")}</h1>
      <p className="mt-1 text-gray-600">{t("voucher.redeem.subtitle")}</p>

      <form onSubmit={onLookup} className="mt-6 flex flex-col gap-2 sm:flex-row">
        {/*
          Obrys pola i kolor podpowiedzi są ZMIERZONE, nie domyślne:
          `border-gray-300` dawało 1.47:1 (SC 1.4.11 wymaga 3:1 dla obrysu
          elementu interaktywnego), a domyślny placeholder Tailwinda
          (`gray-400`) 2.55:1 przy progu 4.5:1 (SC 1.4.3). Pilnuje tego bramka
          `_grow/tools/validate_vendor_panel_voucher_contrast.py`, która czyta
          TE KLASY, a nie ręczną listę par (review-fix cyklu 1, MEDIUM-2).
        */}
        <input
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t("voucher.redeem.code_placeholder")}
          className="w-full min-h-[44px] flex-1 rounded border border-gray-500 px-3 py-2 text-base placeholder:text-gray-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          aria-label={t("voucher.redeem.code_label")}
        />
        <button
          type="submit"
          className="w-full min-h-[44px] rounded bg-blue-700 px-4 py-2 text-base text-white hover:bg-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-50 sm:w-auto"
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

      {lookup.kind === "found" && redeem.kind !== "done" && (
        <div
          data-testid="voucher-lookup-card"
          className="mt-4 space-y-3 rounded border border-gray-200 bg-white p-4"
        >
          <div>
            <div className="text-xs uppercase text-gray-500">
              {t("voucher.redeem.product")}
            </div>
            <div className="text-lg font-medium">
              {lookup.voucher.product_title}
            </div>
          </div>
          {/*
            Metryki vouchera: JEDNA kolumna na telefonie, dwie dopiero od
            `sm:`. `grid-cols-2` bez prefiksu gniotło etykiety przy 360 px.
          */}
          <div
            data-testid="voucher-metrics"
            className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2"
          >
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

          {redeem.kind === "error" && (
            <p role="alert" className="text-sm text-red-700">
              {t(redeem.messageKey)}
            </p>
          )}
        </div>
      )}

      {/*
        AC1 (UX-DR6) — główny przycisk realizacji leży POZA kartą metryk,
        w DOLNEJ strefie ekranu. Na telefonie strefa jest przyklejona do dołu
        viewportu (`sticky bottom-0`), czyli w łuku kciuka jednej ręki; od `sm:`
        wraca do normalnego przepływu, bo na desktopie pasek przyklejony do dołu
        tylko zjada wysokość. Dowodem NIE jest obecność klasy, tylko POZYCJA
        W DRZEWIE: przycisk następuje po karcie metryk (asercja
        `compareDocumentPosition` w `voucher-redeem.spec.tsx`).
      */}
      {lookup.kind === "found" &&
        redeem.kind !== "done" &&
        lookup.voucher.status !== "claimed" && (
          <div
            data-testid="voucher-redeem-actions"
            className="sticky bottom-0 -mx-4 mt-4 border-t border-gray-200 bg-white p-4 sm:static sm:mx-0 sm:border-0 sm:p-0"
          >
            <button
              type="button"
              onClick={onRedeem}
              disabled={redeem.kind === "loading"}
              data-testid="voucher-redeem-action"
              className="w-full min-h-[44px] rounded bg-green-800 px-4 py-2 text-base text-white hover:bg-green-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-50"
            >
              {redeem.kind === "loading"
                ? t("voucher.redeem.redeeming")
                : t("voucher.redeem.redeem_action")}
            </button>
          </div>
        )}

      {redeem.kind === "done" && (
        <div
          role="status"
          ref={confirmationRef}
          tabIndex={-1}
          data-testid="voucher-redeem-confirmation"
          className="mt-4 space-y-3 rounded border border-green-200 bg-green-50 p-4 text-green-900"
        >
          {/*
            PIERWSZY PLAN (AC4, UX-DR11): co i kiedy, zdaniami po polsku.
            Żaden surowy identyfikator techniczny nie ma tu prawa być —
            asercje 5.5 („bez `prior_status`”, „bez `already_claimed`”) są
            zawężone DOKŁADNIE do tego regionu, bo koperta poniżej niesie te
            wartości z premedytacją: UX-DR11 wymaga ZEJŚCIA danych audytowych
            pod „Szczegóły”, a nie ich wycięcia.
          */}
          <div data-testid="voucher-confirmation-primary" className="space-y-2">
            <div className="text-lg font-semibold">
              {redeem.idempotent
                ? t("voucher.redeem.idempotent_done")
                : t("voucher.redeem.redeemed_now")}
            </div>
            <p data-testid="voucher-confirmation-what">
              {t("voucher.redeem.confirmation_what", {
                product: redeem.voucher.product_title,
                value: formatMoney(
                  redeem.voucher.value_minor,
                  redeem.voucher.currency_code,
                ),
              })}
            </p>
            {/*
              „Kiedy” mówi PRAWDĘ o ścieżce: przy powtórzeniu `claimed_at`
              opisuje realizację, która zaszła WCZEŚNIEJ, a nie tę próbę
              (regresja LOW-2 z 5.5 nie może wrócić inną drogą).
            */}
            <p data-testid="voucher-confirmation-when">
              {t(
                redeem.idempotent || redeem.envelope.prior_status === "claimed"
                  ? "voucher.redeem.confirmation_when_earlier"
                  : "voucher.redeem.confirmation_when",
                { when: formatWhen(redeem.envelope.claimed_at, i18n.language) },
              )}
            </p>
            {/*
              Zdanie o PRZEJŚCIU pokazuje się wyłącznie wtedy, gdy przejście
              faktycznie zaszło (review-fix cyklu 1 do 5.5, LOW-2).
            */}
            {redeem.envelope.prior_status !== "claimed" &&
              !redeem.idempotent && (
                <p>
                  {t("voucher.redeem.transition", {
                    prior: statusLabel(redeem.envelope.prior_status),
                    next: statusLabel("claimed"),
                  })}
                </p>
              )}
          </div>

          {/*
            KOPERTA AUDYTOWA — natywne `<details>`: domyślnie zwinięte, obsługa
            klawiaturą i czytnikiem ekranu bez ani jednej linii JS-u.
          */}
          <details
            data-testid="voucher-audit-details"
            className="rounded border border-green-200 bg-white p-2 text-sm"
          >
            <summary className="w-full min-h-[44px] flex cursor-pointer items-center px-2 py-3 text-base text-green-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
              {t("voucher.redeem.details_summary")}
            </summary>
            <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase text-gray-600">
                  {t("voucher.redeem.details_market_id")}
                </dt>
                <dd className="break-all font-mono">
                  {redeem.envelope.market_id ??
                    t("voucher.redeem.details_market_none")}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-gray-600">
                  {t("voucher.redeem.details_status_transition")}
                </dt>
                <dd className="break-all font-mono">
                  {`${redeem.envelope.prior_status} → ${redeem.envelope.new_status}`}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-gray-600">
                  {t("voucher.redeem.details_claimed_at")}
                </dt>
                <dd className="break-all font-mono">
                  {redeem.envelope.claimed_at}
                </dd>
              </div>
            </dl>
            {/*
              `audit_log_id` NIE ma osobnego wiersza w `dl`: niósłby ten sam
              identyfikator, co zdanie poniżej, a dwie kopie tej samej wartości
              na jednym ekranie to nie jest „pełniejsza koperta”, tylko szum.
              Numer zgłoszenia zostaje ZDANIEM (kosmetolożka podaje go
              wsparciu), ale schodzi z pierwszego planu razem z resztą koperty.
              `vendor_id` i `seller_id` NIE wchodzą na ekran: nie mają odbiorcy
              po tej stronie — decyzja zapisana w Dev Agent Record.
            */}
            <p className="mt-2">
              {t("voucher.redeem.audit_reference", {
                id: redeem.envelope.audit_log_id,
              })}
            </p>
          </details>

          <button
            type="button"
            onClick={reset}
            className="mt-2 w-full min-h-[44px] rounded border border-green-900 px-4 py-2 text-base text-green-900 hover:bg-green-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 sm:w-auto"
          >
            {t("voucher.redeem.reset")}
          </button>
        </div>
      )}
    </div>
  )
}

export default VoucherRedeem
