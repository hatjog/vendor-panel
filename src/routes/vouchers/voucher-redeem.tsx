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
 * Auth (v1.15.0 Story 5.8, AC2 — zapowiedź z v1.9.0 ZASTĄPIONA, nie spełniona):
 * trasy `/vendor/vouchers/:code/{lookup,redeem}` są ZWOLNIONE z bramki HMAC
 * wpisami w `VENDOR_HMAC_EXEMPT_ROUTES` z transportem `mercur-seller-context`.
 * Zapowiedź „a future iteration will inject the HMAC signer inside fetchQuery"
 * NIE zostaje zrealizowana i nie zostanie: przeglądarka nie może trzymać
 * materiału podpisującego S2S — sekret w kliencie jest sekretem opublikowanym.
 * Do 5.8 panel wołał te trasy zwykłą sesją zza bramki HMAC i dostawał `401`.
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
 * v1.15.0 Story 5.8 (FR-10d, FR-10e, FR-10f, UX-DR8, UX-DR9, AD-17, AD-20):
 *   - Klucz idempotencji jest GENEROWANY W PANELU przed pierwszą próbą
 *     i NIEZMIENIONY przy ponowieniu (`idempotencyKeyRef`). Bez niego
 *     powtórka po utracie sieci jest dla serwera nowym żądaniem, a dla
 *     kosmetolożki — nieodróżnialna od realizacji przez kogoś innego na tym
 *     samym koncie salonu.
 *   - Wynik ma TRZY rozróżnialne zdania po polsku: „zrealizowałaś teraz",
 *     „to była Twoja powtórka" i „już zrealizowany innym żądaniem" (ten
 *     ostatni jest ODMOWĄ `409`, bo `claimed` nie jest na allow-liście
 *     stanów wejściowych).
 *   - Odmowa niesie ROZRÓŻNIALNY powód (`zrealizowany` / `wycofany` /
 *     `wygasły`) jako zdanie przez `t()`. „Nie twój" i „nieznany" pozostają
 *     nieodróżnialne — obie ścieżki mają JEDEN komunikat `not_found`.
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

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { useMe } from "../../hooks/api/users"
import {
  REDEEM_REFUSAL_I18N_KEYS,
  voucherStatusI18nKey,
  type RedeemRefusalReason as RefusalReason,
} from "../../i18n/voucher-state-vocabulary"
import {
  newIdempotencyKey,
  VoucherApiError,
  voucherFetch,
} from "../../lib/client/voucher-client"

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
   * kontraktu (`voucher-state-vocabulary.v3.yaml`), a nie tego pliku —
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
  /**
   * Stan SPRZED przejścia albo `null`. `null` znaczy „serwer nie zna stanu
   * sprzed" (voucher zrealizowany przed 5.8) — a nie „stan bieżący"
   * (review-fix cyklu 1, LOW).
   */
  prior_status: string | null
  new_status: "claimed" | "already_claimed"
  claimed_at: string
}

/**
 * Dwa wyniki, które kończą się `200` (v1.15.0 Story 5.8, AC6). Trzeci przypadek
 * — „już zrealizowany INNYM żądaniem" — jest odmową i żyje w `RedeemState`
 * jako `refused` z powodem `already_redeemed`.
 */
type RedeemOutcome = "redeemed_now" | "replayed_same_request"

/**
 * ALLOW-LISTA stanów, w których przycisk realizacji ma prawo się pokazać
 * (AD-17, review-fix cyklu 1, finding MEDIUM).
 *
 * Lustro `VOUCHER_REDEMPTION_INPUT_STATES` z backendu. Wcześniej stała tu
 * NEGACJA `status !== "claimed"` — czyli dokładnie ten kształt, który ta story
 * usuwa z backendu, bo przepuszcza `withdrawn` i `expired`. Skutek dla
 * kosmetolożki: aktywny przycisk „Oznacz jako zrealizowany" nad voucherem
 * wycofanym, kliknięcie w ścianę i powód dopiero z `409`.
 *
 * AD-17 jest regułą architektoniczną, a nie regułą jednego pliku, więc panel
 * bramkuje po PRZYNALEŻNOŚCI DO ZBIORU, nie po nieobecności jednej wartości.
 */
const REDEEMABLE_STATUSES: readonly string[] = ["idle", "consent_pending"]

/**
 * Powód, dla którego stan NIE pozwala na realizację — ten sam zbiór etykiet,
 * co odmowa serwera (UX-DR9), pokazany ZANIM kosmetolożka kliknie.
 * `claimed` ma własny, łagodniejszy komunikat (`already_claimed`).
 */
const NON_REDEEMABLE_REASON: Record<string, RefusalReason | undefined> = {
  withdrawn: "withdrawn",
  expired: "expired",
  refunded: "refunded",
}

function refusalFromError(error: unknown): RefusalReason | null {
  if (!(error instanceof VoucherApiError)) return null
  if (error.reason && error.reason in REDEEM_REFUSAL_I18N_KEYS) {
    return error.reason as RefusalReason
  }
  return null
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
  /** Odmowa z ROZRÓŻNIALNYM powodem (UX-DR9) — osobny stan, nie błąd sieci. */
  | { kind: "refused"; reason: RefusalReason }
  | {
      kind: "done"
      outcome: RedeemOutcome
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

/**
 * Długości grup kodu vouchera: `XX-XXXX-XXXX`.
 *
 * Lustro `buildVoucherCode` z backendu
 * (`packages/api/src/workflows/entitlements/live-issue-from-payment-intent.ts`):
 * dwuznakowy prefiks rynku + dwie czwórki z alfabetu bez `0/O/1/I/L`.
 * Trzymamy TU wyłącznie kształt (grupy), nie alfabet — pole nie może odrzucać
 * znaków, których zbiór jest własnością backendu; kosmetolożka przepisuje kod
 * z wydruku i musi zobaczyć to, co wpisała, a odmowa należy do lookupu.
 */
const VOUCHER_CODE_GROUPS = [2, 4, 4] as const

const VOUCHER_CODE_BODY_LENGTH = VOUCHER_CODE_GROUPS.reduce((a, b) => a + b, 0)

/**
 * Kanoniczna postać tego, co użytkownik wpisał: WIELKIE litery, bez znaków
 * spoza `[A-Z0-9]`, myślniki dostawione automatycznie.
 *
 * Myślnik NIE jest znakiem do wpisania — jest dekoracją grup. Wpisanie
 * `bok5t7ma6v`, wklejenie `bo k5t7 ma6v` i wklejenie `BO-K5T7-MA6V` dają ten
 * sam wynik. Nadmiar ponad {@link VOUCHER_CODE_BODY_LENGTH} znaków jest
 * ucinany, bo dłuższy ciąg nie jest kodem vouchera w żadnym rynku.
 */
export function formatVoucherCodeInput(raw: string): string {
  const body = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, VOUCHER_CODE_BODY_LENGTH)
  const groups: string[] = []
  let at = 0
  for (const size of VOUCHER_CODE_GROUPS) {
    if (at >= body.length) {
      break
    }
    groups.push(body.slice(at, at + size))
    at += size
  }
  return groups.join("-")
}

const countCodeChars = (value: string) => value.replace(/[^A-Z0-9]/gi, "").length

/**
 * Pozycja kursora w SFORMATOWANEJ wartości, wyrażona liczbą znaków kodu na
 * lewo od niego. Liczymy po znakach kodu, bo maskowanie wstawia i usuwa
 * myślniki — indeks liczony w surowym ciągu przesuwałby kursor przy każdym
 * przekroczeniu granicy grupy.
 */
function caretAfterCodeChars(formatted: string, codeCharsBefore: number): number {
  if (codeCharsBefore <= 0) {
    return 0
  }
  let seen = 0
  for (let i = 0; i < formatted.length; i++) {
    if (formatted[i] !== "-") {
      seen += 1
      if (seen === codeCharsBefore) {
        return i + 1
      }
    }
  }
  return formatted.length
}

/**
 * Jedna edycja pola kodu: z poprzedniej wartości, nowej surowej wartości
 * i pozycji kursora robi wartość kanoniczną i pozycję kursora po maskowaniu.
 *
 * Osobna funkcja czysta, bo cała nieoczywistość edycji maski jest tutaj —
 * w komponencie zostaje przypisanie stanu. Przypadek graniczny, który bez tego
 * wygląda jak zawieszony klawisz: Backspace na MYŚLNIKU. Maska odtworzyłaby go
 * natychmiast, więc kasujemy wtedy znak PRZED nim — użytkownik celował w niego,
 * bo myślnika nigdy nie wpisywał.
 */
export function applyVoucherCodeEdit(input: {
  previous: string
  next: string
  caret: number
}): { value: string; caret: number } {
  let next = input.next
  let caret = Math.max(0, Math.min(input.caret, next.length))
  const removedOneChar = input.previous.length - next.length === 1
  if (removedOneChar && input.previous[caret] === "-" && caret > 0) {
    next = next.slice(0, caret - 1) + next.slice(caret)
    caret -= 1
  }
  const value = formatVoucherCodeInput(next)
  return { value, caret: caretAfterCodeChars(value, countCodeChars(next.slice(0, caret))) }
}

export const VoucherRedeem = () => {
  const { t, i18n } = useTranslation()
  /**
   * Salon, w którego zakresie działa ekran. Nośnik tożsamości dla
   * `ensureSellerMiddleware` (`x-seller-id`) — bez niego trasa `/vendor/*`
   * odrzuca żądanie ZANIM dotrze do handlera (review-fix cyklu 1, HIGH).
   */
  const { seller } = useMe()
  const sellerId = seller?.id ?? ""
  const [code, setCode] = useState("")
  const [lookup, setLookup] = useState<LookupState>({ kind: "idle" })
  const [redeem, setRedeem] = useState<RedeemState>({ kind: "idle" })
  const confirmationRef = useRef<HTMLDivElement | null>(null)
  const codeInputRef = useRef<HTMLInputElement | null>(null)
  /**
   * Kursor do przywrócenia po maskowaniu, albo `null` gdy nie ma czego
   * przywracać. React przy kontrolowanym `<input>` odtwarza wartość, ale nie
   * kursor — bez tego każde wpisanie znaku w ŚRODKU kodu wyrzucałoby kursor
   * na koniec pola.
   */
  const codeCaretRef = useRef<number | null>(null)
  /**
   * Klucz idempotencji TEJ akcji użytkownika (UX-DR8, AC6).
   *
   * Powstaje RAZ — przy udanym lookupie, czyli PRZED pierwszą próbą
   * realizacji — i nie zmienia się przy ponowieniu. `useRef`, nie `useState`:
   * klucz nie ma wpływać na render, a każdy re-render z nowym kluczem
   * zamieniłby retry w drugą realizację. Nowy kod ⇒ nowa akcja ⇒ nowy klucz.
   */
  const idempotencyKeyRef = useRef<string | null>(null)

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

  useLayoutEffect(() => {
    const caret = codeCaretRef.current
    if (caret === null) {
      return
    }
    codeCaretRef.current = null
    codeInputRef.current?.setSelectionRange(caret, caret)
  }, [code])

  const onCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value, caret } = applyVoucherCodeEdit({
      previous: code,
      next: e.target.value,
      caret: e.target.selectionStart ?? e.target.value.length,
    })
    codeCaretRef.current = caret
    setCode(value)
  }

  const reset = () => {
    setLookup({ kind: "idle" })
    setRedeem({ kind: "idle" })
    // Nowa akcja użytkownika = nowy klucz. Gdyby klucz przeżył reset, kolejna
    // realizacja (innego kodu!) wyglądałaby dla serwera jak powtórka tej.
    idempotencyKeyRef.current = null
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
    idempotencyKeyRef.current = null
    try {
      const data = await voucherFetch(
        `/vendor/vouchers/${encodeURIComponent(trimmed)}/lookup`,
        { method: "GET", sellerId },
      )
      if (data?.voucher) {
        // Klucz powstaje TUTAJ — przed pierwszą próbą realizacji, raz na
        // znaleziony voucher. Generowanie go w `onRedeem` dawałoby nowy klucz
        // na każde kliknięcie, czyli dokładnie zachowanie sprzed 5.8.
        idempotencyKeyRef.current = newIdempotencyKey()
        setLookup({ kind: "found", voucher: data.voucher as VendorVoucherView })
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
    // Klucz z REF-a, nie świeży: to jest cała treść AC6. Gdyby go tu nie było
    // (np. stan po odświeżeniu komponentu), lepiej odmówić niż wysłać żądanie
    // bez bariery idempotencji — serwer i tak odrzuci je `400`.
    const idempotencyKey = idempotencyKeyRef.current
    if (!idempotencyKey) {
      setRedeem({
        kind: "error",
        messageKey: "voucher.redeem.error.redeem_failed",
      })
      return
    }
    setRedeem({ kind: "loading" })
    try {
      const data = await voucherFetch(
        `/vendor/vouchers/${encodeURIComponent(
          lookup.voucher.code,
        )}/redeem`,
        {
          method: "POST",
          sellerId,
          headers: { "Idempotency-Key": idempotencyKey },
        },
      )
      if (data?.envelope) {
        const outcome: RedeemOutcome =
          data.outcome === "replayed_same_request"
            ? "replayed_same_request"
            : data.outcome === "redeemed_now"
              ? "redeemed_now"
              : // Serwer sprzed 5.8 nie zna pola `outcome`; wtedy nośnikiem
                // rozróżnienia zostaje `idempotent`. Odwrotna kolejność
                // (najpierw `idempotent`) ignorowałaby nowe pole.
                Boolean(data.idempotent)
                ? "replayed_same_request"
                : "redeemed_now"
        setRedeem({
          kind: "done",
          outcome,
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
    } catch (err) {
      // Odmowa z rozróżnialnym powodem (UX-DR9) NIE jest błędem sieci
      // i nie wolno jej zwinąć do „spróbuj ponownie za chwilę": ponowienie
      // realizacji vouchera wycofanego nigdy się nie uda.
      const reason = refusalFromError(err)
      if (reason) {
        setRedeem({ kind: "refused", reason })
        return
      }
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
        {/*
          `autoCapitalize="characters"` jest dla KLAWIATURY telefonu (podnosi
          shift), a nie dla wartości — wielkie litery wymusza maska, więc
          wklejenie i klawiatura sprzętowa też je dostają.

          ŚWIADOMIE BEZ `maxLength`: atrybut tnie ciąg SUROWY, zanim maska
          zdąży odrzucić spacje i myślniki, więc wklejenie „ bo-k5t7 ma6v "
          gubiło ostatni znak kodu, a dopisanie znaku w środku pełnego kodu
          nie działało wcale (zmierzone: 2 czerwone testy maski). Limit należy
          do maski, która liczy ZNAKI KODU, nie znaki w polu.
        */}
        <input
          ref={codeInputRef}
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          value={code}
          onChange={onCodeChange}
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

          {/*
            Stan spoza allow-listy (`withdrawn`, `expired`) mówi POWÓD ZANIM
            kosmetolożka kliknie — przycisk już się dla tych stanów nie pokazuje
            (AD-17, UX-DR9, review-fix cyklu 1). Wcześniej powód przychodził
            dopiero z `409`, po kliknięciu w ścianę.
          */}
          {NON_REDEEMABLE_REASON[lookup.voucher.status] && (
            <p
              role="status"
              data-testid="voucher-not-redeemable"
              className="text-sm text-red-700"
            >
              {t(
                REDEEM_REFUSAL_I18N_KEYS[
                  NON_REDEEMABLE_REASON[lookup.voucher.status] as RefusalReason
                ],
              )}
            </p>
          )}

          {redeem.kind === "error" && (
            <p role="alert" className="text-sm text-red-700">
              {t(redeem.messageKey)}
            </p>
          )}

          {/*
            ODMOWA Z POWODEM (AC7, UX-DR9). Osobny blok, nie ten sam co błąd
            sieci: „spróbuj ponownie za chwilę" jest przy voucherze wycofanym
            radą, która nigdy nie zadziała. Kolor NIE jest jedynym nośnikiem
            znaczenia — zdanie mówi wprost, co się stało (WCAG 2.1 SC 1.4.1).
          */}
          {redeem.kind === "refused" && (
            <p
              role="alert"
              data-testid="voucher-redeem-refusal"
              className="text-sm text-red-700"
            >
              {t(REDEEM_REFUSAL_I18N_KEYS[redeem.reason])}
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
        // Po odmowie z powodem przycisk ZNIKA: ponowienie nie zmieni wyniku,
        // a zostawiony przycisk zaprasza do klikania w ścianę.
        redeem.kind !== "refused" &&
        // ALLOW-LISTA, nie negacja (AD-17) — patrz `REDEEMABLE_STATUSES`.
        REDEEMABLE_STATUSES.includes(lookup.voucher.status) && (
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
            {/*
              TRZY przypadki, nie dwa (AC6, UX-DR8). Trzeci — „już zrealizowany
              INNYM żądaniem" — nie dociera tutaj: jest odmową i renderuje się
              w bloku `refused` powyżej. Dzięki temu „to była Twoja powtórka"
              znaczy DOKŁADNIE to i nic więcej; przed 5.8 to samo zdanie
              opisywało również realizację przez kogoś innego na tym koncie.
            */}
            <div
              className="text-lg font-semibold"
              data-testid="voucher-confirmation-outcome"
            >
              {redeem.outcome === "replayed_same_request"
                ? t("voucher.redeem.outcome_replayed")
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
                redeem.outcome === "replayed_same_request" ||
                  redeem.envelope.prior_status === "claimed"
                  ? "voucher.redeem.confirmation_when_earlier"
                  : "voucher.redeem.confirmation_when",
                { when: formatWhen(redeem.envelope.claimed_at, i18n.language) },
              )}
            </p>
            {/*
              Zdanie o PRZEJŚCIU pokazuje się wyłącznie wtedy, gdy przejście
              faktycznie zaszło (review-fix cyklu 1 do 5.5, LOW-2).
            */}
            {redeem.envelope.prior_status !== null &&
              redeem.envelope.prior_status !== "claimed" &&
              redeem.outcome === "redeemed_now" && (
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
                  {`${redeem.envelope.prior_status ?? "—"} → ${redeem.envelope.new_status}`}
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
