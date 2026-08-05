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
  VOUCHER_STATUSES,
  VOUCHER_STATUS_I18N_KEYS,
} from "../../../i18n/voucher-state-vocabulary"

const fetchQuery = vi.hoisted(() => vi.fn())
vi.mock("../../../lib/client/client", () => ({ fetchQuery }))

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
    expect(screen.getByPlaceholderText("Kod vouchera")).toBeTruthy()
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
    expect(done.textContent).not.toContain("consent_pending")
    expect(done.textContent).not.toContain("prior_status")
    expect(done.textContent).not.toContain("new_status")
    // Identyfikator audytu zostaje, ale jako informacja użytkowa ze zdaniem.
    expect(done.textContent).toContain("Numer zgłoszenia do wsparcia: aud_123")

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
    expect(within(done).getByText("Ten voucher był już zrealizowany wcześniej."))
      .toBeTruthy()
    // `already_claimed` NIE jest stanem vouchera i nie może wyciec na ekran.
    expect(done.textContent).not.toContain("already_claimed")
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
