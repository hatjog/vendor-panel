// @vitest-environment jsdom
/**
 * AC2 / AC3 / AC4 (v1.15.0 Story 5.5) — ekran realizacji vouchera mierzony
 * WYKONANIEM: polskie napisy w renderze, stan ze słownika o jednym źródle,
 * kolor NIGDY jako jedyny nośnik znaczenia.
 *
 * Czego ten plik świadomie NIE robi:
 *   - nie sprawdza obecności klucza w JSON-ie zamiast napisu na ekranie
 *     (klucz bez wartości przechodziłby taki test na angielskim fallbacku),
 *   - nie asertuje podciągów identyfikatorów technicznych — dowodem jest
 *     ZDANIE, które widzi kosmetolożka.
 *
 * i18n idzie przez REALNĄ konfigurację panelu (`defaultI18nOptions`),
 * język `pl`. Angielski fallback jest tu WYKRYWANY, nie tolerowany: asercje
 * porównują z polskimi napisami, więc każdy niedomknięty klucz czerwieni test.
 */

import { TooltipProvider } from "@medusajs/ui"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  render,
  screen,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nextProvider } from "react-i18next"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { createTestI18n } from "../../../i18n/__tests__/test-i18n"
import {
  REDEEM_REFUSAL_I18N_KEYS,
  VOUCHER_STATUSES,
  VOUCHER_STATUS_I18N_KEYS,
} from "../../../i18n/voucher-state-vocabulary"

/**
 * v1.15.0 Story 5.8 (AC2/AC6): ekran woła `voucherFetch` z dedykowanego klienta
 * (`lib/client/voucher-client`), a nie `fetchQuery`. Zmiana nośnika jest
 * WYMUSZONA: `fetchQuery` nie wysyła ciasteczka sesji (a `ensureSellerMiddleware`
 * Mercura bierze `seller_id` z sesji) i gubi z odpowiedzi błędu pola `code`
 * i `reason`, czyli rozróżnialny powód odmowy (UX-DR9).
 *
 * Podmieniamy WYŁĄCZNIE `voucherFetch`; `newIdempotencyKey` i `VoucherApiError`
 * zostają PRAWDZIWE — inaczej suita mierzyłaby własne atrapy zamiast
 * mechanizmu klucza idempotencji.
 */
const fetchQuery = vi.hoisted(() => vi.fn())
vi.mock("../../../lib/client/voucher-client", async () => {
  const actual = await vi.importActual<
    typeof import("../../../lib/client/voucher-client")
  >("../../../lib/client/voucher-client")
  return { ...actual, voucherFetch: fetchQuery }
})

/**
 * `useMe` podmieniony CELOWO (review-fix cyklu 1, HIGH): ekran bierze stąd
 * `seller.id`, żeby wysłać `x-seller-id`. Prawdziwy hook uderzałby w sieć
 * przez `fetchQuery`, czego jsdom nie obsłuży, a suita mierzyłaby wtedy
 * zachowanie react-query, nie ekranu.
 */
vi.mock("../../../hooks/api/users", () => ({
  useMe: () => ({ seller: { id: "sel_1" } }),
}))

import { VoucherApiError } from "../../../lib/client/voucher-client"
import { VoucherRedeem } from "../voucher-redeem"

const CODE = "GP-TEST-0001"

function voucherView(status: string) {
  return {
    code: CODE,
    seller_id: "sel_1",
    seller_name: "Salon Testowy",
    seller_handle: "salon-testowy",
    product_title: "Masaż relaksacyjny",
    value_minor: 25000,
    currency_code: "PLN",
    status,
    market_id: "bonbeauty",
    expires_at: null,
  }
}

let i18n: Awaited<ReturnType<typeof createTestI18n>>

beforeAll(async () => {
  i18n = await createTestI18n("pl")
})

// Vitest bez `globals: true` NIE rejestruje auto-cleanup RTL — bez tego DOM
// kumuluje się między testami i zapytania trafiają w poprzedni render.
afterEach(cleanup)
beforeEach(() => fetchQuery.mockReset())

const renderScreen = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={["/vouchers/redeem"]}>
            <VoucherRedeem />
          </MemoryRouter>
        </I18nextProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )

/** Wpisuje kod i klika „Sprawdź kod” — wyłącznie interakcjami użytkownika. */
async function lookUp(user: ReturnType<typeof userEvent.setup>, code = CODE) {
  await user.type(screen.getByLabelText("Kod vouchera"), code)
  await user.click(screen.getByRole("button", { name: "Sprawdź kod" }))
}

describe("AC2 — wszystkie teksty przez i18n, z polskimi tłumaczeniami", () => {
  it("ekran startowy jest po polsku i nie zawiera surowych kluczy ani angielskiego fallbacku", () => {
    const { container } = renderScreen()

    expect(
      screen.getByRole("heading", { name: "Zrealizuj voucher" }),
    ).toBeTruthy()
    expect(
      screen.getByPlaceholderText("Kod vouchera (XX-XXXX-XXXX)"),
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Sprawdź kod" })).toBeTruthy()

    assertNoRawKeysNorMissingSentinel(container)
  })

  it("komunikat o zbyt krótkim kodzie jest polskim zdaniem w roli alert", async () => {
    const user = userEvent.setup()
    renderScreen()

    await user.type(screen.getByLabelText("Kod vouchera"), "ab")
    await user.click(screen.getByRole("button", { name: "Sprawdź kod" }))

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toBe(
      "Wpisz kod vouchera — potrzebne są co najmniej 3 znaki.",
    )
    expect(fetchQuery).not.toHaveBeenCalled()
  })

  it("„nie znaleziono” jest polskim zdaniem odczytywalnym przez czytnik ekranu", async () => {
    const user = userEvent.setup()
    fetchQuery.mockRejectedValueOnce(Object.assign(new Error("x"), { status: 404 }))
    renderScreen()
    await lookUp(user)

    const status = await screen.findByRole("status")
    expect(status.textContent).toContain("Nie znaleziono vouchera o tym kodzie.")
  })

  it("pusta odpowiedź serwera daje POLSKI komunikat, nie 'Empty response'", async () => {
    const user = userEvent.setup()
    fetchQuery
      .mockResolvedValueOnce({ voucher: voucherView("idle") })
      .mockResolvedValueOnce({})
    renderScreen()
    await lookUp(user)

    await user.click(
      await screen.findByRole("button", { name: "Oznacz jako zrealizowany" }),
    )

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toBe(
      "Serwer nie odesłał potwierdzenia realizacji. Sprawdź kod ponownie przed kolejną próbą.",
    )
    expect(document.body.textContent).not.toContain("Empty response")
  })

  it("błąd realizacji daje POLSKI komunikat, nie 'Redeem failed' ani treści wyjątku", async () => {
    const user = userEvent.setup()
    fetchQuery
      .mockResolvedValueOnce({ voucher: voucherView("idle") })
      .mockRejectedValueOnce(new Error("Redeem failed"))
    renderScreen()
    await lookUp(user)

    await user.click(
      await screen.findByRole("button", { name: "Oznacz jako zrealizowany" }),
    )

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toBe(
      "Nie udało się oznaczyć vouchera jako zrealizowanego. Spróbuj ponownie za chwilę.",
    )
    expect(document.body.textContent).not.toContain("Redeem failed")
  })

  it("koperta sukcesu nie pokazuje surowego `prior_status → new_status`", async () => {
    const user = userEvent.setup()
    fetchQuery.mockResolvedValueOnce({ voucher: voucherView("idle") }).mockResolvedValueOnce({
      idempotent: false,
      envelope: {
        audit_log_id: "aud_123",
        vendor_id: "ven_1",
        seller_id: "sel_1",
        market_id: "bonbeauty",
        code: CODE,
        prior_status: "consent_pending",
        new_status: "claimed",
        claimed_at: "2026-08-05T10:00:00.000Z",
      },
    })
    const { container } = renderScreen()
    await lookUp(user)
    await user.click(
      await screen.findByRole("button", { name: "Oznacz jako zrealizowany" }),
    )

    const done = await screen.findByRole("status")
    expect(done.textContent).toContain("Voucher oznaczony jako zrealizowany.")
    // Przejście jest ZDANIEM ze słownika, nie surową kopertą techniczną.
    expect(done.textContent).toContain(
      "Stan vouchera zmienił się z „Czeka na zgodę obdarowanej osoby” na „Zrealizowany”.",
    )
    // Story 5.6 (AC4/UX-DR11) ZAWĘŻA tę asercję do PIERWSZEGO PLANU. Reguła
    // 5.5 brzmiała „surowa koperta nie jest treścią dla użytkownika” i taka
    // zostaje — ale UX-DR11 wymaga, żeby dane audytowe ZESZŁY pod „Szczegóły”,
    // a nie zniknęły. Asercja na całym `done` mierzyłaby teraz WYCIĘCIE, czyli
    // dokładnie to, czego AC4 zakazuje.
    const primary = within(done).getByTestId("voucher-confirmation-primary")
    expect(primary.textContent).not.toContain("consent_pending")
    expect(primary.textContent).not.toContain("prior_status")
    expect(primary.textContent).not.toContain("new_status")
    // Kontrola przeciwna: koperta NAPRAWDĘ zeszła, a nie została usunięta.
    const details = within(done).getByTestId("voucher-audit-details")
    expect(details.textContent).toContain("consent_pending → claimed")
    // Identyfikator audytu zostaje, ale jako informacja użytkowa ze zdaniem —
    // pod rozwinięciem, nie na pierwszym planie.
    expect(details.textContent).toContain("Numer zgłoszenia do wsparcia: aud_123")
    expect(primary.textContent).not.toContain("aud_123")

    assertNoRawKeysNorMissingSentinel(container)
  })
})

describe("AC3 — status ze słownika o jednym źródle, zdaniem w języku użytkownika", () => {
  it.each(VOUCHER_STATUSES)(
    "stan `%s` renderuje się jako polskie zdanie ze słownika, nie jako identyfikator",
    async (status) => {
      const user = userEvent.setup()
      fetchQuery.mockResolvedValueOnce({ voucher: voucherView(status) })
      renderScreen()
      await lookUp(user)

      const label = await screen.findByTestId("voucher-status-label")
      const expected = i18n.t(VOUCHER_STATUS_I18N_KEYS[status])

      expect(label.textContent).toBe(expected)
      // Kontrola, że to naprawdę ZDANIE, a nie identyfikator ani jego forma
      // pochodna („Consent_pending”, „Consent pending”, „CONSENT_PENDING”).
      expect(expected).not.toBe(status)
      expect(label.textContent?.toLowerCase()).not.toContain("_")
      expect(label.textContent).not.toBe("__MISSING__" + VOUCHER_STATUS_I18N_KEYS[status])
    },
  )

  it("stan SPOZA słownika ma zdefiniowane zachowanie: zdanie, nie surowy identyfikator", async () => {
    const user = userEvent.setup()
    fetchQuery.mockResolvedValueOnce({ voucher: voucherView("quantum_pending") })
    renderScreen()
    await lookUp(user)

    const label = await screen.findByTestId("voucher-status-label")
    expect(label.textContent).toBe(
      "Stan nierozpoznany — skontaktuj się ze wsparciem",
    )
    expect(document.body.textContent).not.toContain("quantum_pending")
  })

  it("każdy stan ze słownika ma NIEPUSTE polskie tłumaczenie", () => {
    for (const status of VOUCHER_STATUSES) {
      const value = i18n.t(VOUCHER_STATUS_I18N_KEYS[status])
      expect(value.startsWith("__MISSING__")).toBe(false)
      expect(value.trim().length).toBeGreaterThan(0)
      expect(value).not.toBe(VOUCHER_STATUS_I18N_KEYS[status])
    }
  })
})

describe("AC4 — stan komunikowany kolorem I słowem, nigdy samym kolorem (WCAG 1.4.1)", () => {
  it.each(VOUCHER_STATUSES)(
    "stan `%s` niesie TEKSTOWĄ etykietę w drzewie — usunięcie napisu czerwieni ten test",
    async (status) => {
      const user = userEvent.setup()
      fetchQuery.mockResolvedValueOnce({ voucher: voucherView(status) })
      renderScreen()
      await lookUp(user)

      const label = await screen.findByTestId("voucher-status-label")
      expect((label.textContent ?? "").trim().length).toBeGreaterThan(0)
      // Klasa `capitalize` jako mechanizm prezentacji stanu ma ZNIKNĄĆ.
      expect(label.className).not.toContain("capitalize")
    },
  )

  it("komunikat „już zrealizowany” ma rolę statusu i słowo, nie sam kolor", async () => {
    const user = userEvent.setup()
    fetchQuery.mockResolvedValueOnce({ voucher: voucherView("claimed") })
    renderScreen()
    await lookUp(user)

    const status = await screen.findByRole("status")
    expect(status.textContent).toBe(
      "Ten voucher został już oznaczony jako zrealizowany.",
    )
  })

  it("komunikat błędu ma rolę alertu, nie jest samym kolorowym div-em", async () => {
    const user = userEvent.setup()
    fetchQuery.mockRejectedValueOnce(new Error("boom"))
    renderScreen()
    await lookUp(user)

    const alert = await screen.findByRole("alert")
    expect(alert.getAttribute("role")).toBe("alert")
    expect((alert.textContent ?? "").trim().length).toBeGreaterThan(0)
  })

  it("koperta sukcesu jest ogłaszana przez czytnik ekranu", async () => {
    const user = userEvent.setup()
    fetchQuery.mockResolvedValueOnce({ voucher: voucherView("idle") }).mockResolvedValueOnce({
      idempotent: true,
      envelope: {
        audit_log_id: "aud_9",
        vendor_id: "ven_1",
        seller_id: "sel_1",
        market_id: null,
        code: CODE,
        prior_status: "claimed",
        new_status: "already_claimed",
        claimed_at: "2026-08-05T10:00:00.000Z",
      },
    })
    renderScreen()
    await lookUp(user)
    await user.click(
      await screen.findByRole("button", { name: "Oznacz jako zrealizowany" }),
    )

    const done = await screen.findByRole("status")
    // v1.15.0 Story 5.8 (AC6, UX-DR8): zdanie ZMIENIŁO SIĘ i to jest sedno
    // zmiany. „Ten voucher był już zrealizowany wcześniej" opisywało DWIE różne
    // sytuacje naraz — Twoją powtórkę po utracie sieci i realizację przez kogoś
    // INNEGO na tym samym koncie salonu. Teraz `replayed_same_request` znaczy
    // dokładnie jedno; drugi przypadek jest ODMOWĄ z własnym komunikatem.
    expect(
      within(done).getByText(
        "To była Twoja powtórka — voucher jest zrealizowany raz, nie dwa.",
      ),
    ).toBeTruthy()
    // `already_claimed` NIE jest stanem vouchera i nie może wyciec na PIERWSZY
    // PLAN (zawężenie ze Story 5.6 — w kopercie technicznej pod „Szczegóły”
    // jest wartością koperty, nie etykietą stanu pokazywaną kosmetolożce).
    const primary = within(done).getByTestId("voucher-confirmation-primary")
    expect(primary.textContent).not.toContain("already_claimed")
    // Zdanie o PRZEJŚCIU nie może opisywać zmiany, która nie zaszła
    // (review-fix cyklu 1, LOW-2): tu `prior_status` to już `claimed`.
    expect(done.textContent).not.toContain("Stan vouchera zmienił się")
    // Numer zgłoszenia zostaje — kosmetolożka podaje go wsparciu.
    expect(within(done).getByText(/aud_9/)).toBeTruthy()
  })

  it("zdanie o przejściu stanu POJAWIA SIĘ, gdy przejście faktycznie zaszło", async () => {
    const user = userEvent.setup()
    fetchQuery
      .mockResolvedValueOnce({ voucher: voucherView("idle") })
      .mockResolvedValueOnce({
        idempotent: false,
        envelope: {
          audit_log_id: "aud_10",
          vendor_id: "ven_1",
          seller_id: "sel_1",
          market_id: null,
          code: CODE,
          prior_status: "idle",
          new_status: "claimed",
          claimed_at: "2026-08-05T10:00:00.000Z",
        },
      })
    renderScreen()
    await lookUp(user)
    await user.click(
      await screen.findByRole("button", { name: "Oznacz jako zrealizowany" }),
    )

    const done = await screen.findByRole("status")
    // Kontrola dodatnia do asercji wyżej: bez niej „nigdy nie pokazuj zdania”
    // przechodziłoby oba testy, czyli nie mierzyłoby niczego.
    expect(done.textContent).toContain("Stan vouchera zmienił się")
  })
})

/**
 * v1.15.0 Story 5.6 — telefon, jedna ręka, potwierdzenie dla człowieka.
 *
 * Czego te testy świadomie NIE robią: nie mierzą PIKSELI. `jsdom` nie liczy
 * layoutu (`getBoundingClientRect()` zwraca zera), więc udawanie pomiaru
 * rozmiaru byłoby testem, który nie mierzy nic. Rozmiar celu dotykowego
 * i obecność wskaźnika focusu mierzy bramka repo
 * (`_grow/tools/validate_vendor_panel_voucher_touch_targets.py`), która czyta
 * klasy z pliku komponentu. Tutaj mierzone jest to, co jsdom NAPRAWDĘ wie:
 * struktura drzewa, kolejność focusu i treść zdań.
 */
const PHONE_WIDTH = 360

/** Ustawia szerokość telefonu na czas jednego testu. */
function setPhoneViewport() {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: PHONE_WIDTH,
  })
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      // Breakpoint `sm:` w Tailwindzie to 640 px — przy 360 px NIE pasuje.
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

/**
 * Klasy `grid-cols-N`, które NIE mają prefiksu breakpointu — czyli te, które
 * obowiązują na telefonie. Layout mobile-first ma tu dokładnie `grid-cols-1`.
 */
function unprefixedGridCols(el: Element): string[] {
  return el.className
    .split(/\s+/)
    .filter((c) => /^grid-cols-\d+$/.test(c))
}

/** Klasy stałej szerokości w px — nośnik poziomego scrolla przy 360 px. */
function fixedPxWidths(root: HTMLElement): number[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[class]"))
    .flatMap((el) => el.className.split(/\s+/))
    .map((c) => /^w-\[(\d+)px\]$/.exec(c))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]))
}

const ENVELOPE_FRESH = {
  audit_log_id: "aud_360",
  vendor_id: "ven_1",
  seller_id: "sel_1",
  market_id: "bonbeauty",
  code: CODE,
  prior_status: "idle",
  new_status: "claimed",
  claimed_at: "2026-08-06T12:32:00.000Z",
}

const ENVELOPE_IDEMPOTENT = {
  ...ENVELOPE_FRESH,
  audit_log_id: "aud_361",
  prior_status: "claimed",
  new_status: "already_claimed",
  claimed_at: "2026-08-01T09:05:00.000Z",
}

async function redeemThrough(
  user: ReturnType<typeof userEvent.setup>,
  envelope: typeof ENVELOPE_FRESH,
  idempotent: boolean,
) {
  fetchQuery
    .mockResolvedValueOnce({ voucher: voucherView("idle") })
    .mockResolvedValueOnce({ idempotent, envelope })
  renderScreen()
  await lookUp(user)
  await user.click(await screen.findByTestId("voucher-redeem-action"))
  return screen.findByTestId("voucher-redeem-confirmation")
}

describe("5.6 / AC1 — layout mobile-first i główny przycisk w zasięgu kciuka", () => {
  it("przy 360 px metryki vouchera są JEDNOKOLUMNOWE (dwie kolumny dopiero od breakpointu)", async () => {
    setPhoneViewport()
    const user = userEvent.setup()
    fetchQuery.mockResolvedValueOnce({ voucher: voucherView("idle") })
    renderScreen()
    await lookUp(user)

    const metrics = await screen.findByTestId("voucher-metrics")
    // Wariant BEZPREFIKSOWY jest wariantem telefonu — to jest cała definicja
    // mobile-first. `grid-cols-2` bez prefiksu = layout desktopowy, nawet
    // jeśli obok stoi `sm:grid-cols-2`.
    expect(unprefixedGridCols(metrics)).toEqual(["grid-cols-1"])
    expect(metrics.className).toContain("sm:grid-cols-2")
  })

  it("główny przycisk realizacji leży POZA kartą metryk i PO niej w drzewie", async () => {
    setPhoneViewport()
    const user = userEvent.setup()
    fetchQuery.mockResolvedValueOnce({ voucher: voucherView("idle") })
    renderScreen()
    await lookUp(user)

    const card = await screen.findByTestId("voucher-lookup-card")
    const action = screen.getByTestId("voucher-redeem-action")

    // Dowodem jest POZYCJA W DRZEWIE, nie obecność klasy: cofnięcie przycisku
    // do środka karty czerwieni ten test, a klasa `sticky` może zniknąć bez
    // zmiany werdyktu — dlatego nie jest tu nośnikiem dowodu.
    expect(card.contains(action)).toBe(false)
    expect(
      card.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it("przy 360 px żaden element nie ma stałej szerokości przekraczającej viewport", async () => {
    setPhoneViewport()
    const user = userEvent.setup()
    fetchQuery.mockResolvedValueOnce({ voucher: voucherView("idle") })
    const { container } = renderScreen()
    await lookUp(user)

    const tooWide = fixedPxWidths(container).filter((px) => px > PHONE_WIDTH)
    expect(tooWide).toEqual([])
  })
})

describe("5.6 / AC3 — kolejność focusu i przejście focusu na potwierdzenie", () => {
  it("tab przechodzi ekran w kolejności czytania: kod → sprawdź → zrealizuj", async () => {
    setPhoneViewport()
    const user = userEvent.setup()
    fetchQuery.mockResolvedValueOnce({ voucher: voucherView("idle") })
    renderScreen()
    await lookUp(user)
    await screen.findByTestId("voucher-redeem-action")

    // Punkt startowy to pole kodu — pierwszy element w kolejności czytania.
    const input = screen.getByLabelText("Kod vouchera")
    input.focus()
    expect(document.activeElement).toBe(input)
    await user.tab()
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Sprawdź kod" }),
    )
    await user.tab()
    expect(document.activeElement).toBe(
      screen.getByTestId("voucher-redeem-action"),
    )
  })

  it("po realizacji focus trafia NA POTWIERDZENIE, nie zostaje na zniknięciu karty", async () => {
    const user = userEvent.setup()
    const done = await redeemThrough(user, ENVELOPE_FRESH, false)
    expect(document.activeElement).toBe(done)
  })
})

describe("5.6 / AC4 — potwierdzenie mówi CO i KIEDY, koperta schodzi pod „Szczegóły”", () => {
  it("świeża realizacja: co i kiedy po polsku na pierwszym planie, bez surowego identyfikatora", async () => {
    const user = userEvent.setup()
    const done = await redeemThrough(user, ENVELOPE_FRESH, false)
    const primary = within(done).getByTestId("voucher-confirmation-primary")

    expect(
      within(primary).getByTestId("voucher-confirmation-what").textContent,
    ).toContain("Zrealizowano: Masaż relaksacyjny")
    const when = within(primary).getByTestId(
      "voucher-confirmation-when",
    ).textContent
    expect(when).toContain("Data realizacji:")
    // Data po POLSKU, nie ISO-8601 i nie „Invalid Date”.
    expect(when).toContain("sierpnia 2026")
    expect(when).not.toContain("2026-08-06T12:32:00.000Z")
    expect(when).not.toContain("Invalid")
    // Żaden surowy identyfikator techniczny na pierwszym planie.
    expect(primary.textContent).not.toContain("aud_360")
    expect(primary.textContent).not.toContain("bonbeauty")
  })

  it("koperta audytowa JEST na ekranie, ale domyślnie zwinięta", async () => {
    const user = userEvent.setup()
    const done = await redeemThrough(user, ENVELOPE_FRESH, false)
    const details = within(done).getByTestId(
      "voucher-audit-details",
    ) as HTMLDetailsElement

    expect(details.open).toBe(false)
    // Zasada ZEJŚCIA, nie wycięcia: pełna koperta jest w drzewie.
    expect(details.textContent).toContain("aud_360")
    expect(details.textContent).toContain("bonbeauty")
    expect(details.textContent).toContain("idle → claimed")
    expect(details.textContent).toContain("2026-08-06T12:32:00.000Z")
    // `vendor_id` / `seller_id` zostają POZA widokiem — decyzja zapisana
    // w Dev Agent Record, nie przypadek.
    expect(done.textContent).not.toContain("ven_1")
    expect(done.textContent).not.toContain("sel_1")
  })

  it("kontrola przeciwna do „zwinięte”: kliknięcie w „Szczegóły” otwiera kopertę", async () => {
    const user = userEvent.setup()
    const done = await redeemThrough(user, ENVELOPE_FRESH, false)
    const details = within(done).getByTestId(
      "voucher-audit-details",
    ) as HTMLDetailsElement

    // Bez tego testu asercja `open === false` przechodziłaby także wtedy, gdy
    // rozwinięcia NIE DA SIĘ otworzyć — czyli mierzyłaby stałą, nie mechanizm.
    await user.click(within(details).getByText("Szczegóły"))
    expect(details.open).toBe(true)
  })

  it("ścieżka idempotentna mówi PRAWDĘ: kiedy zrealizowano WCZEŚNIEJ, bez zdania o przejściu", async () => {
    const user = userEvent.setup()
    const done = await redeemThrough(user, ENVELOPE_IDEMPOTENT, true)
    const primary = within(done).getByTestId("voucher-confirmation-primary")

    expect(primary.textContent).toContain(
      "To była Twoja powtórka — voucher jest zrealizowany raz, nie dwa.",
    )
    expect(
      within(primary).getByTestId("voucher-confirmation-when").textContent,
    ).toContain("Voucher został zrealizowany wcześniej:")
    expect(primary.textContent).not.toContain("Stan vouchera zmienił się")
    // „Kiedy” opisuje POPRZEDNIĄ realizację, nie tę próbę.
    expect(
      within(primary).getByTestId("voucher-confirmation-when").textContent,
    ).toContain("sierpnia 2026")
  })

  it("potwierdzenie nie zostawia na ekranie surowych kluczy i18n", async () => {
    const user = userEvent.setup()
    const done = await redeemThrough(user, ENVELOPE_FRESH, false)
    assertNoRawKeysNorMissingSentinel(done)
  })
})

/**
 * v1.15.0 Story 5.8 (AC6, AC7) — klucz idempotencji i rozróżnialny powód odmowy
 * mierzone WYKONANIEM, nie obecnością pól w kodzie.
 */
describe("5.8 / AC6+AC7 — klucz idempotencji klienta i powód odmowy", () => {
  const ENVELOPE_58 = {
    audit_log_id: "aud_58",
    vendor_id: "ven_1",
    seller_id: "sel_1",
    market_id: "bonbeauty",
    code: CODE,
    prior_status: "idle",
    new_status: "claimed",
    claimed_at: "2026-08-08T10:00:00.000Z",
  }

  function headerOf(call: unknown[]): string | undefined {
    const init = call[1] as { headers?: Record<string, string> } | undefined
    return init?.headers?.["Idempotency-Key"]
  }

  it("realizacja niesie nagłówek Idempotency-Key, a lookup NIE", async () => {
    const user = userEvent.setup()
    fetchQuery
      .mockResolvedValueOnce({ voucher: voucherView("idle") })
      .mockResolvedValueOnce({ idempotent: false, outcome: "redeemed_now", envelope: ENVELOPE_58 })
    renderScreen()
    await lookUp(user)
    await user.click(
      await screen.findByRole("button", { name: "Oznacz jako zrealizowany" }),
    )
    await screen.findByTestId("voucher-redeem-confirmation")

    expect(headerOf(fetchQuery.mock.calls[0])).toBeUndefined()
    const key = headerOf(fetchQuery.mock.calls[1])
    expect(typeof key).toBe("string")
    expect((key as string).length).toBeGreaterThanOrEqual(8)
  })

  it("PONOWIENIE po błędzie sieci wysyła TEN SAM klucz", async () => {
    // To jest cała treść UX-DR8: utrata sieci po zatwierdzeniu. Gdyby klucz
    // powstawał w obsłudze kliknięcia, drugie żądanie byłoby dla serwera NOWE
    // i saldo zeszłoby drugi raz.
    const user = userEvent.setup()
    fetchQuery
      .mockResolvedValueOnce({ voucher: voucherView("idle") })
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({
        idempotent: true,
        outcome: "replayed_same_request",
        envelope: ENVELOPE_58,
      })
    renderScreen()
    await lookUp(user)

    await user.click(
      await screen.findByRole("button", { name: "Oznacz jako zrealizowany" }),
    )
    await screen.findByRole("alert")
    await user.click(
      await screen.findByRole("button", { name: "Oznacz jako zrealizowany" }),
    )
    await screen.findByTestId("voucher-redeem-confirmation")

    const first = headerOf(fetchQuery.mock.calls[1])
    const second = headerOf(fetchQuery.mock.calls[2])
    expect(first).toBeTruthy()
    expect(second).toBe(first)
  })

  it("NOWY kod dostaje NOWY klucz (reset akcji, nie „klucz na zawsze”)", async () => {
    const user = userEvent.setup()
    fetchQuery
      .mockResolvedValueOnce({ voucher: voucherView("idle") })
      .mockResolvedValueOnce({ idempotent: false, outcome: "redeemed_now", envelope: ENVELOPE_58 })
      .mockResolvedValueOnce({ voucher: voucherView("idle") })
      .mockResolvedValueOnce({ idempotent: false, outcome: "redeemed_now", envelope: ENVELOPE_58 })
    renderScreen()
    await lookUp(user)
    await user.click(
      await screen.findByRole("button", { name: "Oznacz jako zrealizowany" }),
    )
    await screen.findByTestId("voucher-redeem-confirmation")
    await user.click(screen.getByRole("button", { name: "Sprawdź inny kod" }))

    await lookUp(user)
    await user.click(
      await screen.findByRole("button", { name: "Oznacz jako zrealizowany" }),
    )
    await screen.findByTestId("voucher-redeem-confirmation")

    expect(headerOf(fetchQuery.mock.calls[3])).not.toBe(
      headerOf(fetchQuery.mock.calls[1]),
    )
  })

  it.each([
    [
      "already_redeemed",
      "Ten voucher został już zrealizowany wcześniej — innym żądaniem. Nie realizujemy go drugi raz.",
    ],
    ["withdrawn", "Ten voucher został wycofany i nie można go zrealizować."],
    ["expired", "Ten voucher wygasł i nie można go zrealizować."],
    [
      "refunded",
      "Ten voucher został zwrócony — pieniądze wróciły do klientki, więc nie realizujemy zabiegu.",
    ],
    [
      "not_redeemable",
      "Stan tego vouchera nie pozwala na realizację. Zgłoś to wsparciu, podając kod vouchera.",
    ],
  ])(
    "odmowa `%s` jest POLSKIM ZDANIEM, a nie „spróbuj ponownie za chwilę”",
    async (reason, sentence) => {
      const user = userEvent.setup()
      fetchQuery
        .mockResolvedValueOnce({ voucher: voucherView("idle") })
        .mockRejectedValueOnce(
          new VoucherApiError(409, "VOUCHER_X", reason as string, "server text"),
        )
      renderScreen()
      await lookUp(user)
      await user.click(
        await screen.findByRole("button", { name: "Oznacz jako zrealizowany" }),
      )

      const refusal = await screen.findByTestId("voucher-redeem-refusal")
      expect(refusal.textContent).toBe(sentence)
      // Rada „spróbuj ponownie" przy voucherze wycofanym nigdy nie zadziała.
      expect(document.body.textContent).not.toContain("Spróbuj ponownie za chwilę")
      // Surowy tekst serwera nie trafia na ekran kosmetolożki.
      expect(document.body.textContent).not.toContain("server text")
      // Po odmowie przycisk realizacji ZNIKA — nie zaprasza do klikania w ścianę.
      expect(screen.queryByTestId("voucher-redeem-action")).toBeNull()
    },
  )

  it("lustro ADR-209 ma pięć rozłącznych, niepustych kluczy odmowy", () => {
    expect(Object.keys(REDEEM_REFUSAL_I18N_KEYS).sort()).toEqual([
      "already_redeemed",
      "expired",
      "not_redeemable",
      "refunded",
      "withdrawn",
    ])
    expect(new Set(Object.values(REDEEM_REFUSAL_I18N_KEYS)).size).toBe(5)
  })
})

/**
 * review-fix cyklu 1 — findings HIGH (nośnik tożsamości) i MEDIUM (AD-17
 * w panelu). Obie asercje PĘKAJĄ po cofnięciu poprawki, a nie tylko po
 * usunięciu pliku.
 */
describe("review-fix cyklu 1 — tożsamość salonu i allow-lista stanów", () => {
  it("każde żądanie ekranu niesie `sellerId` z zalogowanego salonu (AC2)", async () => {
    const user = userEvent.setup()
    fetchQuery
      .mockResolvedValueOnce({ voucher: voucherView("idle") })
      .mockResolvedValueOnce({
        idempotent: false,
        envelope: {
          audit_log_id: "aud_11",
          vendor_id: "ven_1",
          seller_id: "sel_1",
          market_id: null,
          code: CODE,
          prior_status: "idle",
          new_status: "claimed",
          claimed_at: "2026-08-05T10:00:00.000Z",
        },
      })
    renderScreen()
    await lookUp(user)
    await user.click(
      await screen.findByRole("button", { name: "Oznacz jako zrealizowany" }),
    )

    // Bez tego pola `voucherFetch` nie ma z czego złożyć `x-seller-id`,
    // a `ensureSellerMiddleware` odrzuca żądanie przed handlerem.
    expect(fetchQuery.mock.calls[0][1].sellerId).toBe("sel_1")
    expect(fetchQuery.mock.calls[1][1].sellerId).toBe("sel_1")
  })

  it.each([
    ["withdrawn", "Ten voucher został wycofany i nie można go zrealizować."],
    ["expired", "Ten voucher wygasł i nie można go zrealizować."],
  ])(
    "stan `%s` NIE pokazuje przycisku realizacji i mówi powód od razu (AD-17)",
    async (status, sentence) => {
      const user = userEvent.setup()
      fetchQuery.mockResolvedValueOnce({ voucher: voucherView(status) })
      renderScreen()
      await lookUp(user)

      // Negacja `status !== "claimed"` przepuszczała OBA te stany: przycisk był
      // aktywny, klik kończył się `409`, a powód przychodził dopiero wtedy.
      expect(await screen.findByTestId("voucher-not-redeemable")).toBeTruthy()
      expect(screen.getByTestId("voucher-not-redeemable").textContent).toBe(
        sentence,
      )
      expect(screen.queryByTestId("voucher-redeem-action")).toBeNull()
    },
  )

  it.each(["idle", "consent_pending"])(
    "stan `%s` (allow-lista) nadal pokazuje przycisk — kontrola dodatnia",
    async (status) => {
      const user = userEvent.setup()
      fetchQuery.mockResolvedValueOnce({ voucher: voucherView(status) })
      renderScreen()
      await lookUp(user)

      expect(await screen.findByTestId("voucher-redeem-action")).toBeTruthy()
      expect(screen.queryByTestId("voucher-not-redeemable")).toBeNull()
    },
  )

  it("koperta replayu bez `prior_status` (dane sprzed 5.8) nie zmyśla przejścia", async () => {
    const user = userEvent.setup()
    fetchQuery
      .mockResolvedValueOnce({ voucher: voucherView("idle") })
      .mockResolvedValueOnce({
        idempotent: true,
        outcome: "replayed_same_request",
        envelope: {
          audit_log_id: "aud_12",
          vendor_id: "ven_1",
          seller_id: "sel_1",
          market_id: null,
          code: CODE,
          // Serwer po review-fixie zwraca `null`, a nie stan BIEŻĄCY.
          prior_status: null,
          new_status: "claimed",
          claimed_at: "2026-08-05T10:00:00.000Z",
        },
      })
    renderScreen()
    await lookUp(user)
    await user.click(
      await screen.findByRole("button", { name: "Oznacz jako zrealizowany" }),
    )

    const done = await screen.findByRole("status")
    expect(done.textContent).not.toContain("Stan vouchera zmienił się")
    expect(done.textContent).toContain("Voucher został zrealizowany wcześniej")
  })
})

/**
 * Maska pola kodu — zgłoszenie PO z 2026-08-13: „domyślnie wartości powinny być
 * wprowadzane jako duże litery, pole powinno być sformatowane zgodnie z formatem
 * kodu vouchera, myślniki nie powinny być wymagane do wprowadzenia".
 *
 * Dowodem jest WARTOŚĆ, która wypływa do lookupu, a nie sam napis w polu:
 * kosmetolożka przepisuje kod z wydruku, więc to on musi trafić do URL-a.
 */
describe("pole kodu — maska XX-XXXX-XXXX", () => {
  it("małe litery bez myślników stają się kanonicznym kodem i TAKI leci do lookupu", async () => {
    const user = userEvent.setup()
    fetchQuery.mockResolvedValueOnce({ voucher: voucherView("idle") })
    renderScreen()

    const input = screen.getByLabelText("Kod vouchera") as HTMLInputElement
    await user.type(input, "gptest0001")
    expect(input.value).toBe("GP-TEST-0001")

    await user.click(screen.getByRole("button", { name: "Sprawdź kod" }))
    expect(fetchQuery).toHaveBeenCalledWith(
      "/vendor/vouchers/GP-TEST-0001/lookup",
      expect.objectContaining({ method: "GET" }),
    )
  })

  it("wklejony kod z myślnikami i spacjami nie podwaja separatorów", async () => {
    const user = userEvent.setup()
    renderScreen()

    const input = screen.getByLabelText("Kod vouchera") as HTMLInputElement
    await user.click(input)
    await user.paste(" bo-k5t7 ma6v ")

    expect(input.value).toBe("BO-K5T7-MA6V")
  })

  it("ucina nadmiar ponad 10 znaków kodu — dłuższy ciąg nie jest kodem vouchera", async () => {
    const user = userEvent.setup()
    renderScreen()

    const input = screen.getByLabelText("Kod vouchera") as HTMLInputElement
    await user.type(input, "bok5t7ma6vXXXX")

    expect(input.value).toBe("BO-K5T7-MA6V")
  })

  it("Backspace na myślniku kasuje znak PRZED nim, a nie odtwarza separatora w kółko", async () => {
    const user = userEvent.setup()
    renderScreen()

    const input = screen.getByLabelText("Kod vouchera") as HTMLInputElement
    await user.type(input, "bok")
    expect(input.value).toBe("BO-K")

    // Dwa Backspace'y: pierwszy zdejmuje „K", drugi trafia w myślnik — bez
    // obsługi tego przypadku maska wstawiałaby go z powrotem i klawisz
    // wyglądałby na martwy.
    await user.type(input, "{backspace}{backspace}")
    expect(input.value).toBe("B")
  })

  it("znak dopisany w ŚRODKU kodu nie wyrzuca kursora na koniec pola", async () => {
    const user = userEvent.setup()
    renderScreen()

    const input = screen.getByLabelText("Kod vouchera") as HTMLInputElement
    await user.type(input, "botest0001")
    expect(input.value).toBe("BO-TEST-0001")

    input.setSelectionRange(2, 2)
    await user.type(input, "x", { initialSelectionStart: 2, initialSelectionEnd: 2 })

    expect(input.value).toBe("BO-XTES-T000")
    expect(input.selectionStart).toBe(4)
  })
})

/**
 * Żaden widoczny tekst nie może być surowym kluczem i18n ani sentynelem
 * brakującego tłumaczenia. To jest ta asercja, która odróżnia „klucz istnieje”
 * od „klucz się rozwiązuje w tym namespace, w którym jest wołany”.
 *
 * CZEGO TEN HELPER NIE MIERZY (review-fix cyklu 1, LOW-1): angielskiego
 * fallbacku. `parseMissingKeyHandler` odpala się dopiero, gdy klucza nie ma
 * TAKŻE w `en.json` — klucz obecny po angielsku, a brakujący po polsku,
 * rozwinie się do angielskiego napisu bez `__MISSING__` i bez surowego klucza.
 * Angielski fallback mierzą: jawne asercje na POLSKIE ZDANIA w testach powyżej
 * oraz parity `pl` ↔ `en` (`validate-translations.spec.ts` i bramka
 * `_grow/tools/validate_vendor_panel_voucher_i18n.py`). Nazwa helpera mówi
 * dokładnie tyle, ile helper sprawdza.
 */
function assertNoRawKeysNorMissingSentinel(container: HTMLElement) {
  const text = container.textContent ?? ""
  expect(text).not.toContain("__MISSING__")
  expect(text).not.toMatch(/\bvoucher\.(redeem|status)\./)
}

// Utrzymuje wywołanie w użyciu także wtedy, gdy powyższe testy się zmienią.
export { assertNoRawKeysNorMissingSentinel }
