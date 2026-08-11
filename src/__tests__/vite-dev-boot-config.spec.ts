import { describe, expect, it } from "vitest"

import {
  assertCspSource,
  buildMercurVirtualModules,
  createVendorPanelViteConfig,
  mercurVirtualEsbuildPlugin,
} from "../dev/vite-config"

// DW-15-162. Ten plik pilnuje własności, z których każda była już przyczyną panelu,
// który odpowiada 200 i nie renderuje się wcale:
//  1. `@mercurjs/vendor` nie wraca do `optimizeDeps.exclude` (ściana 5),
//  2. plugin esbuild ma REALNE WEJŚCIE — filtr i namespace, którymi się zarejestrował,
//  3. rozluźnienie CSP dev servera nie wycieka na `preview` (ściana 4),
//  4. klucz cache prebundla idzie za adresem backendu — a plugin w konfiguracji jest
//     zbudowany z TYCH SAMYCH wartości, które trafiają do `define`,
//  5. adres backendu nie może wstrzyknąć dyrektywy do CSP.
//
// Asercje celowo NIE importują stałych z konfiguracji: test porównujący się z własnym
// źródłem jest lustrem, nie pomiarem. Filtr i namespace bierzemy z tego, co plugin
// faktycznie zarejestrował w esbuildzie.

type RecordedResolve = {
  filter: RegExp
  callback: (args: { path: string }) => { path: string; namespace: string } | null
}

type RecordedLoad = {
  filter: RegExp
  namespace?: string
  callback: (args: { path: string }) => { contents: string; loader: string }
}

const NOT_MATCHED_BY_FILTER = Symbol("nietrafiony filtrem")

const resolveConfig = () =>
  createVendorPanelViteConfig({ mode: "development", command: "serve" })

const scriptSrcOf = (csp: string): string => directiveOf(csp, "script-src")
const connectSrcOf = (csp: string): string => directiveOf(csp, "connect-src")

const directiveOf = (csp: string, name: string): string =>
  csp
    .split(";")
    .map((directive) => directive.trim())
    .find((directive) => directive.startsWith(`${name} `)) ?? ""

const modulesFor = (backendUrl: string): Record<string, string> =>
  buildMercurVirtualModules({
    backendUrl,
    storefrontUrl: "http://storefront.example.test:3001",
    base: "/",
  })

const capturePlugin = (modules: Record<string, string>) => {
  const plugin = mercurVirtualEsbuildPlugin(modules)
  let resolve: RecordedResolve | undefined
  let load: RecordedLoad | undefined

  plugin.setup({
    onResolve: (options: RecordedResolve, callback: RecordedResolve["callback"]) => {
      resolve = { ...options, callback }
    },
    onLoad: (options: RecordedLoad, callback: RecordedLoad["callback"]) => {
      load = { ...options, callback }
    },
  } as never)

  if (!resolve || !load) {
    throw new Error("plugin nie zarejestrował onResolve/onLoad")
  }

  return { plugin, resolve, load }
}

// Przechodzi PRZEZ zarejestrowany filtr, tak jak zrobiłby to esbuild — a nie omija go
// wywołaniem callbacku wprost. Zmiana filtra na niepasujący ma tu poczerwienieć.
const routeThroughEsbuild = (
  recorded: ReturnType<typeof capturePlugin>,
  path: string
) => {
  if (!recorded.resolve.filter.test(path)) {
    return NOT_MATCHED_BY_FILTER
  }
  return recorded.resolve.callback({ path })
}

describe("konfiguracja dev panelu sprzedawcy (DW-15-162)", () => {
  it("prebundluje @mercurjs/vendor zamiast go wykluczać", () => {
    const config = resolveConfig()

    expect(config.optimizeDeps?.exclude ?? []).not.toContain("@mercurjs/vendor")
    expect(config.optimizeDeps?.include ?? []).toContain("@mercurjs/vendor")
  })

  it("wpina plugin modułów wirtualnych zbudowany z TYCH SAMYCH wartości co define", () => {
    const config = resolveConfig()
    const plugins = config.optimizeDeps?.esbuildOptions?.plugins ?? []
    const names = plugins.map((plugin) => plugin.name)

    expect(names).toHaveLength(1)
    expect(names[0]).toMatch(/^gp-mercur-virtual-modules-esbuild-[0-9a-f]{12}$/)

    // Klucz cache musi odpowiadać treści, która NAPRAWDĘ trafia do prebundla.
    // Plugin zbudowany z innego obiektu modułów niż konfiguracja dałby nazwę
    // niezależną od `backendUrl` i cały mechanizm byłby pozorny.
    const define = config.define as Record<string, string>
    const expected = mercurVirtualEsbuildPlugin(
      buildMercurVirtualModules({
        backendUrl: JSON.parse(define.__BACKEND_URL__),
        storefrontUrl: JSON.parse(define.__STOREFRONT_URL__),
        base: JSON.parse(define.__BASE__),
      })
    )

    expect(names[0]).toBe(expected.name)
  })

  it("plugin esbuild ma wejście: filtr łapie virtual:mercur/*, namespace się zgadza", () => {
    const backendUrl = "http://backend.example.test:9002"
    const recorded = capturePlugin(modulesFor(backendUrl))

    const resolved = routeThroughEsbuild(recorded, "virtual:mercur/config")
    expect(resolved).not.toBe(NOT_MATCHED_BY_FILTER)
    expect(resolved).toMatchObject({ path: "virtual:mercur/config" })

    const namespace = (resolved as { namespace: string }).namespace
    expect(namespace).toBeTruthy()
    // Bez `namespace` przy `onLoad` esbuild nigdy nie odda ładowania temu pluginowi.
    expect(recorded.load.namespace).toBe(namespace)

    expect(recorded.load.callback({ path: "virtual:mercur/config" }).contents).toContain(
      backendUrl
    )
  })

  it("nieznany klucz virtual:mercur/* jest odmawiany, nie zaślepiany", () => {
    const recorded = capturePlugin(modulesFor("http://backend.example.test:9002"))

    expect(routeThroughEsbuild(recorded, "virtual:mercur/nie-istnieje")).toBeNull()
    expect(routeThroughEsbuild(recorded, "react-dom")).toBe(NOT_MATCHED_BY_FILTER)
  })

  it("dev server dopuszcza inline script i widzi backend w connect-src", () => {
    const config = resolveConfig()
    const csp = config.server?.headers?.[
      "Content-Security-Policy"
    ] as string
    const define = config.define as Record<string, string>

    expect(scriptSrcOf(csp)).toContain("'unsafe-inline'")
    expect(connectSrcOf(csp)).toContain(
      new URL(JSON.parse(define.__BACKEND_URL__)).origin
    )
  })

  it("preview NIE dziedziczy rozluźnień dev servera", () => {
    const config = resolveConfig()

    // Jawny nagłówek preview jest CZĘŚCIĄ ASERCJI: `resolvePreviewOptions` w vite
    // robi `preview?.headers ?? server.headers`, więc brak tego pola oznaczałby
    // ciche rozluźnienie CSP dla wszystkiego, co poda build z `vite build`.
    const csp = config.preview?.headers?.["Content-Security-Policy"]
    expect(csp).toBeDefined()

    const scriptSrc = scriptSrcOf(csp as string)
    expect(scriptSrc).toContain("'self'")
    expect(scriptSrc).not.toContain("'unsafe-inline'")
    expect(scriptSrc).not.toContain("'unsafe-eval'")
    expect(connectSrcOf(csp as string)).not.toContain("ws:")
  })

  it("klucz cache prebundla zmienia się razem z adresem backendu", () => {
    const first = mercurVirtualEsbuildPlugin(modulesFor("http://a.example.test:9002"))
    const second = mercurVirtualEsbuildPlugin(modulesFor("http://b.example.test:9002"))

    expect(first.name).not.toBe(second.name)
    expect(first.name).toBe(
      mercurVirtualEsbuildPlugin(modulesFor("http://a.example.test:9002")).name
    )
  })

  it("adres backendu nie może wstrzyknąć dyrektywy CSP ani zawęzić jej ścieżką", () => {
    expect(assertCspSource("http://backend.example.test:9002/v1/admin")).toBe(
      "http://backend.example.test:9002"
    )
    expect(() => assertCspSource("http://x.example.test; script-src *")).toThrow()
    expect(() => assertCspSource("nie-jest-urlem")).toThrow()
    // Origin NIEPRZEZROCZYSTY przechodzi przez `new URL()`, a `.origin` daje
    // literał "null" — jedyna ścieżka, której sam rozbiór URL-a nie zatrzymuje.
    expect(() => assertCspSource("data:text/plain,x")).toThrow()
  })
})
