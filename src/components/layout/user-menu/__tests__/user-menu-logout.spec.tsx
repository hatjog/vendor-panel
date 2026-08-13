// @vitest-environment jsdom
/**
 * Zgłoszenie PO 2026-08-13: „nie ma możliwości zrobienia logout z portalu
 * sellera i nie mogłem się zalogować innym użytkownikiem — nie widzę takiej
 * opcji w menu".
 *
 * Przyczyna NIE leżała w `Logout` — ta pozycja istniała cały czas. Menu było
 * NIEOTWIERALNE: `UserBadge` renderował `DropdownMenu.Trigger` z
 * `disabled={!member}`, a `useUserMe()` po DW-15-172 czyta `/vendor/sellers/me`,
 * które zwraca `seller`, nie `member`. Pozycja „Wyloguj" była więc obecna
 * w drzewie i nieosiągalna dla kciuka.
 *
 * Dlatego dowodem TUTAJ jest WYKONANIE: klik w odznakę użytkownika i klik
 * w „Wyloguj", z asercją, że wylogowanie NAPRAWDĘ się odpaliło. Test na samą
 * obecność `<Logout />` w kodzie przechodziłby także w wersji z awarią.
 *
 * `useUserMe` jest tu REALNY — mockowany jest dopiero transport (`fetchQuery`),
 * bo to on decydował o kształcie danych. Mock hooka omijałby całą naprawę.
 */

import { TooltipProvider } from "@medusajs/ui"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nextProvider } from "react-i18next"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { createTestI18n } from "../../../../i18n/__tests__/test-i18n"

const { fetchQuery, logout, clearStoredSellerId } = vi.hoisted(() => ({
  fetchQuery: vi.fn(),
  logout: vi.fn(async () => {}),
  clearStoredSellerId: vi.fn(),
}))

vi.mock("../../../../lib/client/client", () => ({
  fetchQuery,
  sdk: { auth: { logout } },
}))
vi.mock("../../../../lib/client/seller-context", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../lib/client/seller-context")
  >("../../../../lib/client/seller-context")
  return { ...actual, clearStoredSellerId }
})

import { KeybindProvider } from "../../../../providers/keybind-provider"
import { ThemeProvider } from "../../../../providers/theme-provider"
import { UserMenu } from "../user-menu"

const SELLER = {
  id: "sel_1",
  name: "Salon Testowy",
  email: "salon@example.test",
  photo: "",
}

let i18n: Awaited<ReturnType<typeof createTestI18n>>

beforeAll(async () => {
  i18n = await createTestI18n("pl")
  // jsdom nie ma `matchMedia`, a `ThemeProvider` pyta o preferencję systemową.
  // Stub jest tu WYŁĄCZNIE po to, żeby drzewo się wyrenderowało — motyw nie
  // jest przedmiotem tego testu.
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    })
  }
})

beforeEach(() => {
  fetchQuery.mockReset()
  logout.mockClear()
  fetchQuery.mockResolvedValue({ seller: SELLER })
})

afterEach(() => cleanup())

const renderMenu = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={["/"]}>
            <ThemeProvider>
              <KeybindProvider shortcuts={[]}>
                <UserMenu />
              </KeybindProvider>
            </ThemeProvider>
          </MemoryRouter>
        </I18nextProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )

describe("menu użytkownika — wyjście z sesji", () => {
  it("odznaka użytkownika otwiera menu i pokazuje pozycję wylogowania", async () => {
    const user = userEvent.setup()
    renderMenu()

    const trigger = await screen.findByRole("button", { name: /Salon Testowy/ })
    expect(trigger.hasAttribute("disabled")).toBe(false)

    await user.click(trigger)

    expect(
      await screen.findByRole("menuitem", { name: /Wyloguj/i }),
    ).toBeTruthy()
  })

  it("klik w „Wyloguj” NAPRAWDĘ kończy sesję (a nie tylko renderuje pozycję)", async () => {
    const user = userEvent.setup()
    renderMenu()

    await user.click(await screen.findByRole("button", { name: /Salon Testowy/ }))
    await user.click(await screen.findByRole("menuitem", { name: /Wyloguj/i }))

    expect(logout).toHaveBeenCalledTimes(1)
  })

  it("brak tożsamości NIE zamyka wyjścia z sesji — menu wciąż się otwiera", async () => {
    // Odpowiedź bez `seller` to dokładnie stan sprzed naprawy: `member` jest
    // `undefined`. Wtedy użytkownik traci nazwę w odznace, ale nie może
    // stracić możliwości wylogowania — inaczej konto zostaje zablokowane
    // w przeglądarce.
    fetchQuery.mockResolvedValue({})
    const user = userEvent.setup()
    renderMenu()

    // `expanded: false` celuje w PRZEŁĄCZNIK menu (ma `aria-expanded`), a nie
    // w przycisk-szkielet ze stanu ładowania — bez tego klik trafiałby w stan
    // sprzed odpowiedzi i test przechodziłby z pustym menu.
    await user.click(await screen.findByRole("button", { expanded: false }))

    expect(
      await screen.findByRole("menuitem", { name: /Wyloguj/i }),
    ).toBeTruthy()
  })
})
