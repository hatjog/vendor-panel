// @vitest-environment jsdom
/**
 * v1.16.0 Story 5.2 (AC2, R-3) — `ProtectedRoute` przy błędzie `useMe()`
 * rozróżnia KLASĘ odpowiedzi: tylko odmowa aktora (401/403 → `forbidden`)
 * kieruje na /login; zły format (HTML z błędnego `__BACKEND_URL__`), backend
 * nieosiągalny i brak trasy renderują zlokalizowany `ResponseErrorState`,
 * a NIE surowy komunikat klienta przekazany do ekranu logowania.
 *
 * KONTROLA DODATNIA: z `seller` renderuje się outlet (ekran chroniony).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { i18n as I18n } from "i18next"
import { I18nextProvider } from "react-i18next"
import { RouterProvider, createMemoryRouter } from "react-router-dom"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { createTestI18n } from "../../../../i18n/__tests__/test-i18n"
import pl from "../../../../i18n/translations/pl.json"
import {
  PanelResponseError,
  networkFailure,
  type ResponseClass,
} from "../../../../lib/client/response-class"

const { meState, passthrough, logoutMock } = vi.hoisted(() => ({
  meState: { isPending: false, error: null } as {
    seller?: unknown
    isPending: boolean
    error: unknown
    refetch?: () => unknown
  },
  passthrough: ({ children }: { children: unknown }) => children,
  logoutMock: { calls: 0 },
}))

vi.mock("../../../../hooks/api/users", () => ({
  useMe: () => meState,
}))
// Logout: the network call is replaced; `onSettled` is what the route relies on.
vi.mock("../../../../hooks/api/auth", () => ({
  useLogout: () => ({
    isPending: false,
    mutate: (_: unknown, opts?: { onSettled?: () => void }) => {
      logoutMock.calls += 1
      opts?.onSettled?.()
    },
  }),
}))
vi.mock("../../../../providers/talkjs-provider", () => ({ TalkjsProvider: passthrough }))
vi.mock("../../../../providers/sidebar-provider", () => ({ SidebarProvider: passthrough }))
vi.mock("../../../../providers/search-provider", () => ({ SearchProvider: passthrough }))

import { ProtectedRoute } from "../protected-route"

const SELLER_KEY = "gp_vendor_seller_id"

let i18n: I18n
beforeAll(async () => {
  i18n = await createTestI18n("pl")
  // jsdom in this toolchain exposes no usable `localStorage` (same in-memory
  // double as `routes/__tests__/panel-screen-mount.spec.tsx`).
  const store = new Map<string, string>()
  const storage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    },
  }
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true })
  // `<Navigate>` under jsdom fails on the jsdom/undici `AbortSignal` mismatch
  // (same stub as `routes/__tests__/panel-screen-mount.spec.tsx`).
  vi.stubGlobal(
    "Request",
    class {
      readonly url: string
      readonly method: string
      readonly signal: AbortSignal
      constructor(url: unknown, init?: { method?: string; signal?: AbortSignal }) {
        this.url = String(url)
        this.method = init?.method ?? "GET"
        this.signal = init?.signal ?? new AbortController().signal
      }
    }
  )
})
afterEach(() => {
  cleanup()
  window.localStorage.clear()
  logoutMock.calls = 0
  meState.refetch = undefined
})

const plText = (key: string): string =>
  key
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], pl) as string

function renderAt() {
  const router = createMemoryRouter(
    [
      {
        element: <ProtectedRoute />,
        children: [{ path: "/orders", element: <h1>chroniony ekran</h1> }],
      },
      { path: "/login", element: <h1>ekran logowania</h1> },
    ],
    { initialEntries: ["/orders"] }
  )
  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>
  )
  return router
}

function classified(
  status: number,
  responseClass: ResponseClass,
  message: string,
  code: string | null = null
) {
  return new PanelResponseError({ status, responseClass, message, code })
}

describe("ProtectedRoute — klasa błędu useMe() (AC2)", () => {
  const cases: Array<[string, unknown, string]> = [
    [
      "bad_format (200 text/html)",
      classified(200, "bad_format", "200: odpowiedz backendu nie jest JSON-em (text/html)"),
      "responseError.badFormatTitle",
    ],
    [
      "backend nieosiągalny (status 0)",
      networkFailure(new TypeError("Failed to fetch")),
      "responseError.backendFailureTitle",
    ],
    [
      "route_missing (404)",
      classified(404, "route_missing", "404 Not Found (odpowiedz nie jest JSON-em)"),
      "responseError.routeMissingTitle",
    ],
  ]

  for (const [name, error, titleKey] of cases) {
    it(`${name} → zlokalizowany stan błędu, bez przekierowania na /login`, () => {
      meState.seller = undefined
      meState.error = error
      const router = renderAt()
      expect(router.state.location.pathname).toBe("/orders")
      expect(screen.getByTestId("protected-route-response-error")).toBeTruthy()
      expect(screen.getByText(plText(titleKey))).toBeTruthy()
      // surowy komunikat klienta nie trafia na ekran
      expect(document.body.textContent).not.toContain((error as Error).message)
      expect(screen.queryByText("ekran logowania")).toBeNull()
    })

    it(`${name} → stan błędu ma działające akcje wyjścia (ponów, wyloguj i zaloguj ponownie)`, () => {
      let refetches = 0
      meState.seller = undefined
      meState.error = error
      meState.refetch = () => {
        refetches += 1
      }
      window.localStorage.setItem(SELLER_KEY, "sel_stale")
      const router = renderAt()

      fireEvent.click(screen.getByText(plText("responseError.retryAction")))
      expect(refetches).toBe(1)
      expect(router.state.location.pathname).toBe("/orders")

      fireEvent.click(screen.getByText(plText("responseError.reloginAction")))
      expect(logoutMock.calls).toBe(1)
      expect(window.localStorage.getItem(SELLER_KEY)).toBeNull()
      expect(router.state.location.pathname).toBe("/login")
      expect(screen.getByText("ekran logowania")).toBeTruthy()
    })
  }

  it("400 not_allowed kontekstu salonu (R-12) → /login z powodem seller_context, seller id wyczyszczony", () => {
    meState.seller = undefined
    meState.error = classified(
      400,
      "request_rejected",
      "You are not a member of this seller account",
      "not_allowed"
    )
    window.localStorage.setItem(SELLER_KEY, "sel_stale")
    const router = renderAt()
    expect(router.state.location.pathname).toBe("/login")
    expect(router.state.location.search).toBe("?reason=seller_context")
    expect(window.localStorage.getItem(SELLER_KEY)).toBeNull()
    expect(screen.getByText("ekran logowania")).toBeTruthy()
    expect(screen.queryByTestId("protected-route-response-error")).toBeNull()
    // surowy tekst middleware nie trafia do URL ani na ekran
    expect(router.state.location.search).not.toContain("member")
  })

  it("400 bez kodu not_allowed (walidacja) → stan błędu z akcją wyjścia, nie /login", () => {
    meState.seller = undefined
    meState.error = classified(400, "request_rejected", "invalid fields", "invalid_data")
    window.localStorage.setItem(SELLER_KEY, "sel_ok")
    const router = renderAt()
    expect(router.state.location.pathname).toBe("/orders")
    expect(screen.getByText(plText("responseError.requestRejectedTitle"))).toBeTruthy()
    expect(screen.getByText(plText("responseError.reloginAction"))).toBeTruthy()
    expect(window.localStorage.getItem(SELLER_KEY)).toBe("sel_ok")
  })

  it("401 (forbidden) → przekierowanie na /login", () => {
    meState.seller = undefined
    meState.error = classified(401, "forbidden", "401 Unauthorized")
    const router = renderAt()
    expect(router.state.location.pathname).toBe("/login")
    expect(screen.getByText("ekran logowania")).toBeTruthy()
    expect(screen.queryByTestId("protected-route-response-error")).toBeNull()
  })

  it("kontrola dodatnia: z sellerem renderuje się chroniony ekran", () => {
    meState.seller = { id: "sel_test" }
    meState.error = null
    const router = renderAt()
    expect(router.state.location.pathname).toBe("/orders")
    expect(screen.getByText("chroniony ekran")).toBeTruthy()
  })
})
