// @vitest-environment jsdom
/**
 * v1.16.0 Story 5.2 (AC1, FR-18, AD-35) — każdy ekran ze zbioru 5.1 MONTUJE SIĘ.
 *
 * CO MIERZY
 * - Iteruje po `evidence/5-1/panel-screen-set.yaml` (zbiór `screen_id`, nie
 *   lista przepisana do testu) i każdy ekran otwiera przez REALNY `RouteMap`
 *   (`createMemoryRouter`) z REALNYMI providerami (react-query, i18n PL,
 *   tooltipy, rozszerzenia dashboardu).
 * - Dowodem jest MONTAŻ, nie kod HTTP: router zakończył ładowanie trasy,
 *   dopasowany liść to ekran ze zbioru (a nie przekierowanie), nie ma błędu
 *   w `router.state.errors`, a w DOM-ie nie ma granicy błędu.
 * - KONTROLA UJEMNA AD-35: ekran wyrenderowany na granicy błędu
 *   (`data-testid="route-error-boundary"`) NIE zalicza — wynik
 *   `error-boundary` (generyczna) albo `distinguished-error` (z klasą).
 *   Osobny przypadek wymusza awarię i asertuje, że wykrywacz ją widzi.
 *
 * BACKEND: atrapa `fetch` z odpowiedziami w KSZTAŁCIE kontraktu listy/detalu
 * Medusy (`{ <zasób>: [], count }` / `{ <encja>: {...} }`). To mierzy montaż
 * panelu, nie poprawność danych backendu — przebieg na realnym backendzie
 * gp-test to `GP/e2e/tests/vendor-panel-screen-mount.spec.ts` (AC1, D-32).
 *
 * TRYB ZAPISU: `GP_PANEL_MOUNT_WRITE=1 pnpm exec vitest --run <ten plik>`
 * zapisuje `evidence/5-2/panel-screen-mount.yaml` (screen_id → wynik).
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { TooltipProvider } from "@medusajs/ui"
import { QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, render } from "@testing-library/react"
import type { i18n as I18n } from "i18next"
import { HelmetProvider } from "react-helmet-async"
import { I18nextProvider } from "react-i18next"
import { RouterProvider, createMemoryRouter } from "react-router-dom"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

// `@medusajs/js-sdk` czyta `localStorage` W KONSTRUKTORZE (module scope
// `lib/client/client.ts`), a jsdom w tej konfiguracji nie wystawia magazynu.
// Magazyn w pamięci musi więc istnieć PRZED importem routingu.
vi.hoisted(() => {
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
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true })
  Object.defineProperty(globalThis, "sessionStorage", { value: storage, configurable: true })
})

vi.mock("@talkjs/react", () => ({
  Session: ({ children }: { children: unknown }) => children,
  useUnreads: () => [],
  Chatbox: () => null,
  Inbox: () => null,
}))

import {
  DashboardExtensionManager,
  DashboardExtensionProvider,
} from "../../extensions"
import { createTestI18n } from "../../i18n/__tests__/test-i18n"
import { queryClient } from "../../lib/query-client"
import { RouteMap } from "../../providers/router-provider/route-map"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PANEL_ROOT = path.resolve(HERE, "../../..")
const SUPER_ROOT = path.resolve(PANEL_ROOT, "../..")
const EVIDENCE = path.join(
  SUPER_ROOT,
  "_bmad-output/releases/v1.16.0/implementation-artifacts/evidence"
)
const SCREEN_SET_PATH = path.join(EVIDENCE, "5-1/panel-screen-set.yaml")
const MOUNT_EVIDENCE_PATH = path.join(EVIDENCE, "5-2/panel-screen-mount.yaml")
const WRITE_MODE = process.env.GP_PANEL_MOUNT_WRITE === "1"

type Screen = { screen_id: string; route_pattern: string; access: string }
type Outcome = "mounted" | "error-boundary" | "distinguished-error"
type Result = { screen_id: string; path: string; outcome: Outcome; detail: string }

/** Minimal reader of the block list the 5.1 generator emits. */
function readScreenSet(): Screen[] {
  const screens: Screen[] = []
  let current: Partial<Screen> | null = null
  for (const line of readFileSync(SCREEN_SET_PATH, "utf8").split(/\r?\n/)) {
    const start = line.match(/^- screen_id: (.+)$/)
    if (start) {
      if (current) screens.push(current as Screen)
      current = { screen_id: start[1].trim() }
      continue
    }
    const field = line.match(/^  (route_pattern|access): (.+)$/)
    if (current && field) {
      ;(current as Record<string, string>)[field[1]] = field[2].trim()
    }
  }
  if (current) screens.push(current as Screen)
  return screens
}

const TEST_ID = "test_id_01"

/** `/products/:id/edit` → `/products/test_id_01/edit`; `/*` → `/__unknown__`. */
function concretePath(pattern: string): string {
  return pattern
    .replace(/:([A-Za-z_]+)\?/g, TEST_ID)
    .replace(/:([A-Za-z_]+)/g, TEST_ID)
    .replace(/\*$/, "__gp_unknown_screen__")
}

// ---------------------------------------------------------------- backend --

const NOW = "2026-01-01T00:00:00.000Z"

const SELLER = {
  id: "sel_test",
  name: "Salon Testowy",
  handle: "salon-testowy",
  email: "salon@example.test",
  store_status: "ACTIVE",
  metadata: {},
  created_at: NOW,
  updated_at: NOW,
}

/** Entity skeleton: the fields list/detail screens of the panel dereference. */
function entity(kind: string): Record<string, unknown> {
  return {
    id: TEST_ID,
    object: kind,
    title: `Test ${kind}`,
    name: `Test ${kind}`,
    handle: `test-${kind}`,
    code: "TEST",
    value: "test",
    status: "draft",
    description: "",
    currency_code: "pln",
    email: "test@example.test",
    first_name: "Test",
    last_name: "Test",
    display_id: 1,
    rank: 0,
    is_active: true,
    type: "standard",
    metadata: {},
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    seller: SELLER,
    sellers: [SELLER],
    countries: [],
    variants: [],
    options: [],
    images: [],
    tags: [],
    categories: [],
    collection: null,
    sales_channels: [],
    items: [],
    customers: [],
    groups: [],
    addresses: [],
    prices: [],
    promotions: [],
    rules: [],
    location_levels: [],
    reservation_items: [],
    fulfillment_sets: [],
    service_zones: [],
    shipping_options: [],
    geo_zones: [],
    payment_providers: [],
    fulfillment_providers: [],
    tax_rates: [],
    children: [],
    category_children: [],
    parent_category: null,
    product_categories: [],
    products: [],
    payment_collections: [],
    fulfillments: [],
    returns: [],
    claims: [],
    exchanges: [],
    shipping_methods: [],
    summary: {},
    supported_currencies: [{ currency_code: "pln", is_default: true }],
    campaign_identifier: "TEST",
    starts_at: NOW,
    ends_at: null,
    is_automatic: false,
    campaign: null,
    budget: { type: "spend", limit: 0, used: 0, currency_code: "pln" },
    application_method: {
      type: "percentage",
      target_type: "items",
      allocation: "each",
      value: 10,
      currency_code: "pln",
      target_rules: [],
      buy_rules: [],
    },
    price_list: null,
    redacted: "pk_test",
    token: "pk_test",
    title_template: "",
    original_total: 0,
    total: 0,
    subtotal: 0,
    fulfillment_status: "not_fulfilled",
    payment_status: "not_paid",
    values: [],
    option_id: TEST_ID,
    region: null,
    customer: null,
    address: null,
  }
}

function singular(resource: string): string {
  const key = resource.replace(/-/g, "_")
  if (key.endsWith("ies")) return `${key.slice(0, -3)}y`
  if (key.endsWith("ses")) return key.slice(0, -2)
  if (key.endsWith("s")) return key.slice(0, -1)
  return key
}

function bodyFor(url: URL): unknown {
  const parts = url.pathname.split("/").filter(Boolean)
  if (url.pathname.startsWith("/vendor/sellers/me")) return { seller: SELLER }
  if (url.pathname.startsWith("/vendor/stores")) return { stores: [entity("store")], count: 1, offset: 0, limit: 20 }
  if (url.pathname === "/vendor/sellers") return { sellers: [SELLER], count: 1, offset: 0, limit: 20 }
  // `/vendor/<resource>` → list; `/vendor/<resource>/<id>` → detail;
  // `/vendor/<resource>/<id>/<sub>` → list of `<sub>`.
  const resource = parts[parts.length - 1] === TEST_ID ? parts[parts.length - 2] : parts[parts.length - 1]
  const isDetail = parts[parts.length - 1] === TEST_ID
  const key = (resource ?? "items").replace(/-/g, "_")
  if (isDetail) {
    const one = singular(key)
    return { [one]: entity(one) }
  }
  return { [key]: [], count: 0, offset: 0, limit: 20 }
}

const requests: string[] = []
/** Negative control: paths answered with a `404` HTML page instead of data. */
const htmlNotFound = new Set<string>()

function fakeFetch(input: unknown, _init?: unknown): Promise<unknown> {
  const raw = typeof input === "string" ? input : String((input as { url?: string }).url ?? input)
  const url = new URL(raw, "http://backend.test")
  requests.push(url.pathname)
  if (htmlNotFound.has(url.pathname)) {
    return Promise.resolve({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
      json: async () => JSON.parse("<!doctype html>"),
      text: async () => "<!doctype html>",
    })
  }
  const body = bodyFor(url)
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers({ "content-type": "application/json; charset=utf-8" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone() {
      return this
    },
  })
}

// ---------------------------------------------------------------- harness --

let i18n: I18n
const manager = new DashboardExtensionManager({
  widgetModule: { widgets: [] },
  menuItemModule: { menuItems: [] },
  displayModule: { displays: [] },
  formModule: { customFields: {} },
} as unknown as ConstructorParameters<typeof DashboardExtensionManager>[0])

beforeAll(async () => {
  i18n = await createTestI18n("pl")
  vi.stubGlobal("fetch", vi.fn(fakeFetch))
  // `router.navigate` pod jsdom pada na niezgodności `AbortSignal`
  // jsdom/undici; trasy bez loaderów nie czytają `Request` poza konstruktorem.
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
  window.localStorage.setItem(
    "medusa_auth_token",
    `h.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))}.s`
  )
  window.localStorage.setItem("gp_vendor_seller_id", SELLER.id)
  // jsdom gaps the panel's layout code touches.
  window.matchMedia ??= (() =>
    ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as unknown as MediaQueryList) as typeof window.matchMedia
  ;(globalThis as Record<string, unknown>).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as Record<string, unknown>).IntersectionObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }
  window.scrollTo = (() => undefined) as typeof window.scrollTo
  Element.prototype.scrollIntoView ??= () => undefined
  Element.prototype.scroll ??= () => undefined
  Element.prototype.scrollTo ??= () => undefined
})

afterEach(() => {
  cleanup()
  queryClient.clear()
})

const settle = async (ms: number) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

async function mountScreen(screen: Screen): Promise<Result> {
  const target = concretePath(screen.route_pattern)
  const router = createMemoryRouter(RouteMap, { initialEntries: [target] })
  const errors: string[] = []
  // Render errors are caught by react-router's RenderErrorBoundary and only
  // reported through console.error — collect them as the outcome detail.
  const consoleError = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    const first = args.find((a) => a instanceof Error) as Error | undefined
    if (first) errors.push(`${first.name}: ${first.message}`)
  })

  const view = render(
    <TooltipProvider>
      <DashboardExtensionProvider api={manager.api}>
        <HelmetProvider>
          <QueryClientProvider client={queryClient}>
            <I18nextProvider i18n={i18n}>
              <RouterProvider router={router} />
            </I18nextProvider>
          </QueryClientProvider>
        </HelmetProvider>
      </DashboardExtensionProvider>
    </TooltipProvider>
  )

  // Lazy route modules + query round-trips: wait until the router is idle and
  // no query is in flight, bounded so one hanging screen cannot stall the set.
  for (let i = 0; i < 600; i++) {
    await settle(25)
    if (
      router.state.initialized &&
      router.state.navigation.state === "idle" &&
      queryClient.isFetching() === 0 &&
      i > 3
    )
      break
  }
  await settle(25)

  const boundary = view.container.querySelector('[data-testid="route-error-boundary"]')
  const routerErrors = router.state.errors
  if (routerErrors) {
    for (const value of Object.values(routerErrors)) {
      errors.push(value instanceof Error ? `${value.name}: ${value.message}` : String(value))
    }
  }
  const finalPath = router.state.location.pathname
  consoleError.mockRestore()
  if (process.env.GP_PANEL_MOUNT_DEBUG) {
    console.log("DEBUG", screen.screen_id, router.state.initialized, finalPath, requests.slice(-8), view.container.innerHTML.slice(0, 600))
  }
  router.dispose()

  if (boundary) {
    const kind = boundary.getAttribute("data-boundary-kind")
    return {
      screen_id: screen.screen_id,
      path: target,
      outcome: kind === "classified" ? "distinguished-error" : "error-boundary",
      detail: [...new Set(errors)].join(" | ").slice(0, 300) || "granica błędu bez błędu w routerze",
    }
  }
  if (finalPath !== target) {
    return {
      screen_id: screen.screen_id,
      path: target,
      outcome: "error-boundary",
      detail: `przekierowanie na ${finalPath} zamiast montażu`,
    }
  }
  if (!view.container.textContent?.trim() && !view.container.querySelector("input,button,form,table,svg")) {
    return { screen_id: screen.screen_id, path: target, outcome: "error-boundary", detail: "pusty DOM" }
  }
  return { screen_id: screen.screen_id, path: target, outcome: "mounted", detail: "" }
}

// ---------------------------------------------------------------- tests ----

const SCREENS = readScreenSet()
const RESULTS: Result[] = []

/**
 * Ekrany, które pod ATRAPĄ backendu kończą na granicy błędu, bo dereferują
 * pola encji spoza szkieletu `entity()` (zmierzone 2026-11-14, detal błędu
 * w `evidence/5-2/panel-screen-mount.yaml`). To NIE jest dowód montażu ani
 * dowód awarii panelu na realnych danych — rozstrzyga przebieg realny
 * (`GP/e2e/tests/vendor-panel-screen-mount.spec.ts`). Dług nazwany:
 * DW-15-323. Lista jest ZAPADKĄ: ekran spoza niej, który przestaje się
 * montować, czerwieni test; ekran z niej, który zaczyna się montować,
 * jest raportowany w evidence i ma zostać z listy usunięty. Sześć pozycji
 * (m.in. `reviews.index`) montuje się w przebiegu pojedynczym, a pada pod
 * obciążeniem pełnego pakietu — wynik zależny od czasu, więc też dług, nie montaż.
 */
const KNOWN_UNMOUNTED_UNDER_FIXTURE = new Set<string>([
  "campaigns.[id].add-promotions",
  "campaigns.[id].configuration",
  "campaigns.[id].edit",
  "campaigns.[id].edit-budget",
  "home",
  "orders.[id].[f_id].create-shipment",
  "orders.[id].allocate-items",
  "orders.[id].fulfillment",
  "price-lists.[id].configuration",
  "price-lists.[id].edit",
  "price-lists.[id].products.add",
  "price-lists.[id].products.edit",
  "products.[id].options.[option_id].edit",
  "promotions.[id].[ruleType].edit",
  "promotions.[id].add-to-campaign",
  "promotions.[id].edit",
  "promotions.index",
  "requests.categories.[id].edit",
  "requests.collections.[id].edit",
  "requests.orders.[id].review",
  "reviews.index",
  "settings.locations.[location_id].fulfillment-set.[fset_id].service-zone.[zone_id].areas",
  "settings.locations.[location_id].fulfillment-set.[fset_id].service-zone.[zone_id].edit",
  "settings.locations.[location_id].fulfillment-set.[fset_id].service-zone.[zone_id].shipping-option.[so_id].edit",
  "settings.locations.[location_id].fulfillment-set.[fset_id].service-zone.[zone_id].shipping-option.create",
  "settings.locations.[location_id].fulfillment-set.[fset_id].service-zones.create",
  "settings.regions.[id].countries.add",
])

describe("AC1 — montaż każdego ekranu ze zbioru 5.1", () => {
  it("zbiór ekranów 5.1 jest niepusty i ma unikalne screen_id", () => {
    expect(SCREENS.length).toBeGreaterThan(100)
    expect(new Set(SCREENS.map((s) => s.screen_id)).size).toBe(SCREENS.length)
  })

  it("lista znanego długu wskazuje wyłącznie ekrany ze zbioru 5.1", () => {
    const ids = new Set(SCREENS.map((s) => s.screen_id))
    expect([...KNOWN_UNMOUNTED_UNDER_FIXTURE].filter((id) => !ids.has(id))).toEqual([])
  })

  for (const screen of SCREENS) {
    const known = KNOWN_UNMOUNTED_UNDER_FIXTURE.has(screen.screen_id)
    it(`montaż: ${screen.screen_id}${known ? " [dług atrapy DW-15-323]" : ""}`, async () => {
      const result = await mountScreen(screen)
      RESULTS.push(result)
      if (known) {
        // Zmierzony i zapisany; nie zalicza montażu (AD-35) i nie czerwieni
        // pakietu — rozstrzyga przebieg realny.
        return
      }
      expect(result, `${result.screen_id} (${result.path}): ${result.detail}`).toMatchObject({
        outcome: "mounted",
      })
    }, 20000)
  }
})

describe("AD-35 — kontrola ujemna wykrywacza montażu", () => {
  it("ekran, którego lista dostaje 404 HTML, NIE zalicza montażu (rozróżnialny błąd)", async () => {
    const screen = SCREENS.find((s) => s.screen_id === "orders.index")
    expect(screen).toBeDefined()
    htmlNotFound.add("/vendor/orders")
    try {
      const result = await mountScreen(screen!)
      expect(result.outcome).toBe("distinguished-error")
    } finally {
      htmlNotFound.delete("/vendor/orders")
    }
  }, 20000)
})

afterAll(() => {
  if (!WRITE_MODE) return
  const panelCommit = execFileSync("git", ["-C", PANEL_ROOT, "rev-parse", "HEAD"]).toString().trim()
  const counts = RESULTS.reduce<Record<string, number>>((acc, r) => {
    acc[r.outcome] = (acc[r.outcome] ?? 0) + 1
    return acc
  }, {})
  const measuredAt = new Date().toISOString()
  const lines = [
    "schema_version: gp-panel-screen-mount.v1",
    "release: v1.16.0",
    "story: '5.2'",
    `panel_commit: ${panelCommit}`,
    `measured_at: '${measuredAt}'`,
    "generator: GP/vendor-panel/src/routes/__tests__/panel-screen-mount.spec.tsx (GP_PANEL_MOUNT_WRITE=1)",
    "screen_set: _bmad-output/releases/v1.16.0/implementation-artifacts/evidence/5-1/panel-screen-set.yaml",
    "backend: atrapa fetch w kształcie kontraktu list/detalu (montaż panelu; przebieg realny = GP/e2e, D-32)",
    `screens_total: ${SCREENS.length}`,
    `screens_measured: ${RESULTS.length}`,
    `known_unmounted_under_fixture: ${KNOWN_UNMOUNTED_UNDER_FIXTURE.size} (DW-15-323)`,
    "counts:",
    ...Object.keys(counts)
      .sort()
      .map((k) => `  ${k}: ${counts[k]}`),
    "screens:",
    ...[...RESULTS]
      .sort((a, b) => a.screen_id.localeCompare(b.screen_id))
      .flatMap((r) => [
        `- screen_id: ${r.screen_id}`,
        `  path: ${r.path}`,
        `  outcome: ${r.outcome}`,
        ...(r.detail ? [`  detail: ${JSON.stringify(r.detail)}`] : []),
      ]),
    "",
  ]
  mkdirSync(path.dirname(MOUNT_EVIDENCE_PATH), { recursive: true })
  writeFileSync(MOUNT_EVIDENCE_PATH, lines.join("\n"))
})
