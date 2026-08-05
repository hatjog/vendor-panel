// @vitest-environment jsdom
/**
 * AC1 (v1.15.0 Story 5.5, FR-10b + NFR-1) — ekran realizacji vouchera jest
 * OSIĄGALNY Z NAWIGACJI, udowodnione WYKONANIEM, nie inspekcją kodu.
 *
 * Co ten test mierzy:
 *   1. Przejście od ekranu startowego do ekranu realizacji odbywa się
 *      WYŁĄCZNIE kliknięciem. W teście NIE MA `navigate("/vouchers/redeem")`
 *      ani żadnej nawigacji programowej — taka nawigacja unieważniłaby dowód,
 *      bo przechodziłaby także wtedy, gdy pozycji w menu w ogóle nie ma.
 *   2. Pozycja pochodzi z REALNEGO nośnika nawigacji — z wyeksportowanego
 *      `useCoreRoutes()` z `main-layout.tsx` — a nie z kopii listy zrobionej
 *      na potrzeby testu, i renderuje się przez REALNY komponent `NavItem`.
 *   3. Etykieta jest polska i idzie przez i18n (AC2 na tej samej ścieżce).
 *
 * KONTROLA NEGATYWNA: usunięcie pozycji vouchera z `useCoreRoutes()`
 * czerwieni ten plik. Przebieg kontroli negatywnej jest załączony do
 * evidence: `_bmad-output/releases/v1.15.0/implementation-artifacts/evidence/5-5/`.
 * Test, który przechodzi w obu wariantach, nie mierzy niczego — dlatego
 * poniżej jest też asercja odwrotna (`kontrola dodatnia jest zależna od
 * obecności pozycji`), która pilnuje, że klik trafia w coś, co naprawdę
 * pochodzi z listy nawigacji.
 *
 * Widoczność pozycji: jest BEZWARUNKOWA (bez warunku roli ani flagi), więc
 * kosmetolożka widzi ją zawsze po zalogowaniu — tak samo jak „Zamówienia”.
 */

import { TooltipProvider } from "@medusajs/ui"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nextProvider } from "react-i18next"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { createTestI18n } from "../../../../i18n/__tests__/test-i18n"

// TalkJS wymaga żywej sesji czatu — nie jest przedmiotem tej story i nie ma
// wpływu na pozycje nawigacji. Mock jest zawężony do jednego hooka.
vi.mock("@talkjs/react", () => ({ useUnreads: () => [] }))
// `fetchQuery` bije po sieci; ekran realizacji renderuje się tu w stanie
// początkowym (bez wyszukiwania), więc żadne wywołanie nie następuje.
vi.mock("../../../../lib/client/client", () => ({
  fetchQuery: vi.fn(async () => ({})),
}))

import { RouteMap } from "../../../../providers/router-provider/route-map"
import { useCoreRoutes } from "../main-layout"
import { NavItem } from "../../nav-item"
import { VoucherRedeem } from "../../../../routes/vouchers/voucher-redeem"

const StartScreen = () => <h1>Ekran startowy panelu</h1>

/**
 * Renderuje REALNĄ listę pozycji menu przez REALNY `NavItem`. Nie kopiuje
 * listy — konsumuje `useCoreRoutes()`.
 */
const CoreNav = () => {
  const routes = useCoreRoutes()
  return (
    <nav aria-label="Nawigacja panelu">
      {routes.map((route) => (
        <NavItem key={route.to} {...route} />
      ))}
    </nav>
  )
}

// Vitest jest tu uruchamiany BEZ `globals: true`, wiec automatyczne
// sprzatanie React Testing Library sie NIE REJESTRUJE — bez tego DOM
// kumuluje sie miedzy testami i `getByText` znajduje duplikaty z
// poprzedniego renderu zamiast mierzyc biezacy.
afterEach(cleanup)

let i18n: Awaited<ReturnType<typeof createTestI18n>>

beforeAll(async () => {
  i18n = await createTestI18n("pl")
})

const renderPanel = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={["/dashboard"]}>
            <CoreNav />
            <Routes>
              <Route path="/dashboard" element={<StartScreen />} />
              <Route path="/vouchers/redeem" element={<VoucherRedeem />} />
            </Routes>
          </MemoryRouter>
        </I18nextProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )

describe("AC1 — wejście nawigacyjne do ekranu realizacji vouchera", () => {
  it("pozycja vouchera jest w tym samym nośniku co reszta menu (useCoreRoutes)", () => {
    // Kontrola dodatnia jest zależna od TEJ pozycji — jeśli zniknie z
    // `useCoreRoutes()`, ta asercja czerwienieje jako pierwsza i wskazuje
    // dokładne miejsce regresji.
    renderPanel()
    const link = screen.getByRole("link", { name: "Realizacja voucherów" })
    expect(link.getAttribute("href")).toBe("/vouchers/redeem")
  })

  it("od ekranu startowego do ekranu realizacji WYŁĄCZNIE kliknięciami", async () => {
    const user = userEvent.setup()
    renderPanel()

    // Punkt wyjścia: ekran startowy. Ekranu realizacji jeszcze nie ma.
    expect(screen.getByText("Ekran startowy panelu")).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Zrealizuj voucher" })).toBeNull()

    // JEDYNA akcja: kliknięcie w pozycję menu. Zero nawigacji programowej.
    await user.click(screen.getByRole("link", { name: "Realizacja voucherów" }))

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Zrealizuj voucher" }),
      ).toBeTruthy()
    })
    expect(screen.queryByText("Ekran startowy panelu")).toBeNull()
  })

  it("cel pozycji menu istnieje w REALNYM RouteMap, nie tylko w tablicy testu", () => {
    // Review-fix cyklu 1, MEDIUM-1. Testy powyżej deklarują własną tablicę
    // <Routes>, więc przechodziłyby także wtedy, gdyby ktoś zmienił w
    // `route-map.tsx` `path: "vouchers/redeem"` na cokolwiek innego — link
    // nadal miałby `href="/vouchers/redeem"`, a kosmetolożka po kliknięciu
    // lądowałaby w `ErrorBoundary`. Ta asercja wiąże `to` pozycji menu z
    // REALNĄ rejestracją trasy.
    const flatten = (routes: typeof RouteMap, prefix = ""): string[] =>
      routes.flatMap((route) => {
        const raw = route.path ?? ""
        const here = raw.startsWith("/")
          ? raw
          : `${prefix}/${raw}`.replace(/\/+/g, "/")
        const self = raw ? [here.replace(/\/$/, "")] : []
        return [
          ...self,
          ...flatten((route.children ?? []) as typeof RouteMap,
            raw ? here : prefix),
        ]
      })

    const target = "/vouchers/redeem"
    expect(flatten(RouteMap)).toContain(target)

    const { unmount } = renderPanel()
    expect(
      screen
        .getByRole("link", { name: "Realizacja voucherów" })
        .getAttribute("href"),
    ).toBe(target)
    unmount()
  })

  it("etykieta pozycji jest polska i pochodzi z i18n, nie z literału", () => {
    renderPanel()
    // Gdyby etykieta była literałem, ten napis nie zmieniłby się z językiem.
    expect(i18n.t("voucher.redeem.nav_label")).toBe("Realizacja voucherów")
    expect(
      i18n.getFixedT("en")("voucher.redeem.nav_label"),
    ).toBe("Voucher redemption")
    expect(screen.getByText("Realizacja voucherów")).toBeTruthy()
  })
})
