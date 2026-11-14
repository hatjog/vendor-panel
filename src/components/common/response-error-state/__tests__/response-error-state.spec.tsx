// @vitest-environment jsdom
/**
 * v1.16.0 Story 5.2 (AC2, NFR-4) — lista na błędzie klasy X renderuje
 * komunikat X, a NIE `empty-table-content` (stan zakazany).
 *
 * Dowód idzie przez REALNE komponenty (`_DataTable`, `ErrorBoundary`) i REALNE
 * tłumaczenia PL (`createTestI18n`): asercje porównują polskie zdania, więc
 * brakujący klucz (`__MISSING__…`) albo angielski fallback czerwienią test.
 *
 * KONTROLA DODATNIA: ta sama tabela BEZ błędu pokazuje empty-state — inaczej
 * test przechodziłby także wtedy, gdy `_DataTable` nie renderowałby niczego.
 */
import { TooltipProvider } from "@medusajs/ui"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import type { i18n as I18n } from "i18next"
import { I18nextProvider } from "react-i18next"
import { RouterProvider, createMemoryRouter } from "react-router-dom"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { createTestI18n } from "../../../../i18n/__tests__/test-i18n"
import pl from "../../../../i18n/translations/pl.json"
import {
  PanelResponseError,
  type ResponseClass,
} from "../../../../lib/client/response-class"
import { _DataTable } from "../../../table/data-table/data-table"
import { ErrorBoundary } from "../../../utilities/error-boundary"
import { RESPONSE_ERROR_I18N_KEYS } from "../response-error-state"

let i18n: I18n

beforeAll(async () => {
  i18n = await createTestI18n("pl")
})

afterEach(() => cleanup())

const STATUS: Record<ResponseClass, number> = {
  route_missing: 404,
  forbidden: 403,
  backend_failure: 502,
  bad_format: 200,
  request_rejected: 422,
}

const plText = (key: string): string =>
  key
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], pl) as string

function errorOf(responseClass: ResponseClass) {
  return new PanelResponseError({
    status: STATUS[responseClass],
    responseClass,
    message: `test ${responseClass}`,
  })
}

const EMPTY_TITLE = plText("general.noRecordsTitle")

function renderTable(error?: unknown) {
  // `table` nie jest czytany w gałęzi błędu ani w gałęzi empty-state
  // (obie wracają przed renderem wierszy), więc atrapa nie zmienia pomiaru.
  return render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <_DataTable
          table={{} as never}
          columns={[]}
          count={0}
          pageSize={20}
          error={error}
        />
      </TooltipProvider>
    </I18nextProvider>
  )
}

describe("_DataTable — błąd z klasą zamiast fałszywego empty-state", () => {
  it("kontrola dodatnia: bez błędu, count 0 ⇒ empty-state", () => {
    renderTable()
    expect(screen.getByText(EMPTY_TITLE)).toBeTruthy()
    expect(screen.queryByTestId("response-error-state")).toBeNull()
  })

  for (const responseClass of Object.keys(STATUS) as ResponseClass[]) {
    it(`klasa ${responseClass}: komunikat tej klasy, nie empty-state`, () => {
      renderTable(errorOf(responseClass))

      const state = screen.getByTestId("response-error-state")
      expect(state.getAttribute("data-response-class")).toBe(responseClass)
      expect(state.getAttribute("data-response-status")).toBe(
        String(STATUS[responseClass])
      )
      expect(
        screen.getByText(plText(RESPONSE_ERROR_I18N_KEYS[responseClass].title))
      ).toBeTruthy()
      expect(
        screen.getByText(plText(RESPONSE_ERROR_I18N_KEYS[responseClass].message))
      ).toBeTruthy()
      expect(screen.queryByText(EMPTY_TITLE)).toBeNull()
      expect(document.body.textContent).not.toContain("__MISSING__")
    })
  }

  it("komunikaty pięciu klas są parami różne (zlanie dwóch klas = czerwono)", () => {
    const titles = Object.values(RESPONSE_ERROR_I18N_KEYS).map((k) => plText(k.title))
    const messages = Object.values(RESPONSE_ERROR_I18N_KEYS).map((k) =>
      plText(k.message)
    )
    expect(new Set(titles).size).toBe(titles.length)
    expect(new Set(messages).size).toBe(messages.length)
  })
})

describe("ErrorBoundary — klasa odpowiedzi rozróżnia komunikat", () => {
  function renderBoundary(error: unknown) {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          errorElement: <ErrorBoundary />,
          Component: () => {
            throw error
          },
        },
        { path: "/login", element: <div data-testid="login-screen" /> },
      ],
      { initialEntries: ["/"] }
    )
    render(
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>
    )
    return router
  }

  for (const responseClass of ["route_missing", "forbidden", "backend_failure", "bad_format"] as const) {
    it(`klasa ${responseClass}: granica błędu pokazuje komunikat tej klasy`, async () => {
      renderBoundary(errorOf(responseClass))

      const boundary = await screen.findByTestId("route-error-boundary")
      expect(boundary.getAttribute("data-boundary-kind")).toBe("classified")
      expect(
        screen.getByText(plText(RESPONSE_ERROR_I18N_KEYS[responseClass].title))
      ).toBeTruthy()
    })
  }

  it("błąd bez klasy: granica generyczna (kontrola ujemna rozróżnienia)", async () => {
    renderBoundary(new Error("render crash"))

    const boundary = await screen.findByTestId("route-error-boundary")
    expect(boundary.getAttribute("data-boundary-kind")).toBe("generic")
  })

  // `Request` podstawiony: `router.navigate` pod jsdom pada na niezgodności
  // `AbortSignal` jsdom/undici (błąd uprzęży, nie panelu). Trasy nie mają
  // loaderów, więc atrapa nie jest czytana poza konstruktorem.
  it("401 z klasą forbidden nie pokazuje komunikatu, tylko przekierowuje na /login", async () => {
    vi.stubGlobal("Request", class {
      readonly url: string
      readonly method: string
      readonly signal: AbortSignal
      constructor(url: unknown, init?: { method?: string; signal?: AbortSignal }) {
        this.url = String(url)
        this.method = init?.method ?? "GET"
        this.signal = init?.signal ?? new AbortController().signal
      }
    })
    const router = renderBoundary(
      new PanelResponseError({ status: 401, responseClass: "forbidden", message: "x" })
    )

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"))
    expect(await screen.findByTestId("login-screen")).toBeTruthy()
    expect(screen.queryByTestId("route-error-boundary")).toBeNull()
    vi.unstubAllGlobals()
  })
})
