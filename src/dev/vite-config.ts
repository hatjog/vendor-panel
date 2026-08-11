import { createHash } from "node:crypto"
import { createRequire } from "node:module"

import inject from "@medusajs/admin-vite-plugin"
import react from "@vitejs/plugin-react"
import {
  loadEnv,
  type ConfigEnv,
  type DepOptimizationOptions,
  type Plugin,
  type UserConfig,
} from "vite"
import inspect from "vite-plugin-inspect"

// DW-15-162: fabryka konfiguracji panelu mieszka TUTAJ, a nie w `vite.config.mts`,
// z jednego powodu mierzalnego: `vite.config.mts` należy wyłącznie do projektu
// composite `tsconfig.node.json`, więc import z `src/` dawał `TS6305` i pakiet
// testów nie mógł zobaczyć realnej konfiguracji. Bramka, której nie da się
// zaimportować, to bramka, która nie mierzy niczego.

// v1.15.0 Story 5.5 (AC1): `@medusajs/ui` publikuje ESM z importami
// KATALOGOWYMI (`./components/alert`), których Node nie rozwiązuje pod
// vitestem — każdy test dotykający warstwy UI wywalał się na etapie zbierania,
// czyli NIE MIERZYŁ niczego. Mapa `exports` pakietu blokuje jawny deep-import,
// więc alias musi celować w ŚCIEŻKĘ ROZWIĄZANĄ przez resolver.
const requireFromHere = createRequire(import.meta.url)

// Typ pluginu esbuilda bierzemy Z VITE, a nie `from "esbuild"`: `esbuild` NIE jest
// zadeklarowany w `package.json` panelu (figuruje tylko w `pnpm.onlyBuiltDependencies`),
// więc import z niego stałby wyłącznie na `shamefully-hoist=true` z korzenia repo.
type EsbuildPlugin = NonNullable<
  NonNullable<DepOptimizationOptions["esbuildOptions"]>["plugins"]
>[number]

type MercurVirtualModulesOptions = {
  backendUrl: string
  storefrontUrl: string
  base: string
}

// Stale sa PRYWATNE swiadomie: test, ktory asertuje przez zaimportowana stala,
// mierzy sam siebie. Pakiet testow siega po to, co plugin FAKTYCZNIE zarejestrowal.
const MERCUR_VIRTUAL_NAMESPACE = "gp-mercur-virtual"
const MERCUR_VIRTUAL_FILTER = /^virtual:mercur\//
const MERCUR_ESBUILD_PLUGIN_PREFIX = "gp-mercur-virtual-modules-esbuild-"

// Treść modułów wirtualnych powstaje w JEDNYM miejscu i jest konsumowana przez dwa
// pluginy: vite'owy (dla plików serwowanych na żywo) i esbuildowy (dla prebundlingu).
// UWAGA, czego ta wspólnota NIE gwarantuje: po prebundlingu esbuild INLINE'UJE swoją
// kopię do `node_modules/.vite/deps`, więc w runtime istnieją dwie instancje modułu.
// Dopóki są to zamrożone stałe, jest to nieszkodliwe — przestanie być w dniu, w którym
// `virtual:mercur/routes` albo `menu-items` zaczną nieść stan.
export function buildMercurVirtualModules({
  backendUrl,
  storefrontUrl,
  base,
}: MercurVirtualModulesOptions): Record<string, string> {
  return {
    "virtual:mercur/config": `export default ${JSON.stringify({
      backendUrl,
      storefrontUrl,
      base,
      i18n: {},
    })}`,
    "virtual:mercur/routes": "export const customRoutes = []",
    "virtual:mercur/components": "export default []",
    "virtual:mercur/menu-items": "export default []",
    "virtual:mercur/i18n": "export default {}",
  }
}

export function mercurVirtualModulesPlugin(
  modules: Record<string, string>
): Plugin {
  return {
    name: "gp-mercur-virtual-modules",
    resolveId(id) {
      if (Object.prototype.hasOwnProperty.call(modules, id)) {
        return id
      }
    },
    load(id) {
      // Ta sama bramka co w `resolveId` — asymetria (bramka tu, gołe
      // `modules[id]` tam) była miejscem, w którym nieznany klucz cicho dawał
      // `undefined` zamiast czytelnej odmowy.
      if (Object.prototype.hasOwnProperty.call(modules, id)) {
        return modules[id]
      }
    },
  }
}

// DW-15-162 (ściana 5): `@mercurjs/vendor` był wykluczony z prebundlingu
// (`optimizeDeps.exclude`) WYŁĄCZNIE dlatego, że jego `dist` importuje
// `virtual:mercur/*` (12 wystąpień), których optymalizator esbuilda nie rozwiązuje.
// Skutek uboczny wykluczenia: pakiet był serwowany surowy, a jego zależności CJS nie
// dostawały uzgodnienia interopu — panel padał na `qs` („does not provide an export
// named 'default'"), po załataniu na `react-dom`, potem na `lodash.debounce`.
// Dokładanie nazw do `optimizeDeps.include` leczyło objaw. Ten plugin usuwa PRZYCZYNĘ
// wykluczenia, więc wykluczenia już nie ma.
//
// Nazwa niesie SKRÓT TREŚCI i to nie jest kosmetyka: `getConfigHash` w vite 5
// serializuje `esbuildOptions.plugins.map((p) => p.name)` — sama treść modułów
// wirtualnych do klucza cache NIE wchodzi, a `backendUrl` jest po prebundlingu
// zapieczony w `node_modules/.vite/deps`. Bez skrótu w nazwie zmiana
// `VITE_MEDUSA_BACKEND_URL` zostawiłaby panel gadający pod STARY adres.
export function mercurVirtualEsbuildPlugin(
  modules: Record<string, string>
): EsbuildPlugin {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(modules))
    .digest("hex")
    .slice(0, 12)

  return {
    name: `${MERCUR_ESBUILD_PLUGIN_PREFIX}${fingerprint}`,
    setup(build) {
      build.onResolve({ filter: MERCUR_VIRTUAL_FILTER }, (args) => {
        if (!Object.prototype.hasOwnProperty.call(modules, args.path)) {
          // Świadomie NIE zaślepiamy nieznanego klucza: bump `@mercurjs/vendor`
          // wprowadzający nowy `virtual:mercur/*` ma zatrzymać prebundling z
          // nazwą brakującego modułu, a nie wystartować z cichą pustką.
          return null
        }
        return { path: args.path, namespace: MERCUR_VIRTUAL_NAMESPACE }
      })
      build.onLoad(
        { filter: /.*/, namespace: MERCUR_VIRTUAL_NAMESPACE },
        (args) => ({ contents: modules[args.path], loader: "js" })
      )
    },
  }
}

// Wartość idzie do dyrektywy CSP, więc musi być ORIGINEM, nie dowolnym stringiem.
// Rozbiór przez `new URL()` załatwia dwie rzeczy naraz: odrzuca wstrzyknięcie
// (`"http://x; script-src *"` nie jest poprawnym URL-em) i sprowadza adres ze
// ŚCIEŻKĄ do samego originu — inaczej `connect-src` cicho zawężałby się do ścieżki
// i blokował każde żądanie do API. Osobnej bramki wymaga tylko origin NIEPRZEZROCZYSTY
// (`data:`, `javascript:`), bo tam `new URL()` przechodzi, a `.origin` daje "null",
// czyli literał, który w CSP nie jest źródłem.
export function assertCspSource(value: string): string {
  let origin: string
  try {
    origin = new URL(value).origin
  } catch {
    throw new Error(
      `VITE_MEDUSA_BACKEND_URL nie jest poprawnym URL-em: ${JSON.stringify(value)}`
    )
  }
  if (origin === "null") {
    throw new Error(
      `VITE_MEDUSA_BACKEND_URL nie daje sie uzyc jako zrodlo CSP: ${JSON.stringify(value)}`
    )
  }
  return origin
}

// Story v160-7-8: CSP headers — defense-in-depth XSS prevention (NFR-SEC-3).
//
// DW-15-162 (ściana 4): `@vitejs/plugin-react` wstrzykuje preambułę React Refresh
// jako INLINE `<script type="module">`. Bez `'unsafe-inline'` CSP ją blokuje,
// preambuła się nie instaluje, `/src/main.tsx` pada i `#root` zostaje pusty — przy
// `curl` zwracającym 200 na każdym zasobie. `'unsafe-eval'` oraz `ws:`/`wss:` to
// również potrzeby WYŁĄCZNIE dev servera (HMR), więc wariant nie-dev ich nie niesie.
export function buildContentSecurityPolicy({
  backendUrl,
  dev,
}: {
  backendUrl: string
  dev: boolean
}): string {
  const origin = assertCspSource(backendUrl)
  const scriptSrc = dev
    ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'; "
    : "script-src 'self'; "
  const connectSrc = dev
    ? `connect-src 'self' ${origin} ws: wss:; `
    : `connect-src 'self' ${origin}; `

  return (
    "default-src 'self'; " +
    scriptSrc +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    "font-src 'self' data:; " +
    connectSrc +
    "frame-ancestors 'none'; " +
    "form-action 'self'; " +
    "base-uri 'self'"
  )
}

// JEDEN budowniczy nagłówków dla obu serwerów. `resolvePreviewOptions` w vite robi
// `preview?.headers ?? server.headers` — czyli PODMIANĘ CAŁEGO obiektu, nie scalenie.
// Gdyby każdy serwer budował swój zestaw osobno, nagłówek dołożony do dev servera
// zniknąłby z preview po cichu.
export function buildSecurityHeaders(
  backendUrl: string,
  dev: boolean
): Record<string, string> {
  return {
    "Content-Security-Policy": buildContentSecurityPolicy({ backendUrl, dev }),
  }
}

export function createVendorPanelViteConfig({ mode }: ConfigEnv): UserConfig {
  const env = loadEnv(mode, process.cwd())

  const BASE = env.VITE_MEDUSA_BASE || "/"
  const BACKEND_URL = env.VITE_MEDUSA_BACKEND_URL || "http://localhost:9000"
  const STOREFRONT_URL =
    env.VITE_MEDUSA_STOREFRONT_URL || "http://localhost:8000"
  const PUBLISHABLE_API_KEY = env.VITE_PUBLISHABLE_API_KEY || ""
  const TALK_JS_APP_ID = env.VITE_TALK_JS_APP_ID || ""
  const DISABLE_SELLERS_REGISTRATION =
    env.VITE_DISABLE_SELLERS_REGISTRATION || "false"

  /**
   * Add this to your .env file to specify the project to load admin extensions from.
   */
  const MEDUSA_PROJECT = env.VITE_MEDUSA_PROJECT || null
  const sources = MEDUSA_PROJECT ? [MEDUSA_PROJECT] : []

  const virtualModules = buildMercurVirtualModules({
    backendUrl: BACKEND_URL,
    storefrontUrl: STOREFRONT_URL,
    base: BASE,
  })

  return {
    plugins: [
      inspect(),
      react(),
      mercurVirtualModulesPlugin(virtualModules),
      inject({
        sources,
      }),
    ],
    define: {
      __BASE__: JSON.stringify(BASE),
      __BACKEND_URL__: JSON.stringify(BACKEND_URL),
      __STOREFRONT_URL__: JSON.stringify(STOREFRONT_URL),
      __PUBLISHABLE_API_KEY__: JSON.stringify(PUBLISHABLE_API_KEY),
      __TALK_JS_APP_ID__: JSON.stringify(TALK_JS_APP_ID),
      __DISABLE_SELLERS_REGISTRATION__: JSON.stringify(
        DISABLE_SELLERS_REGISTRATION
      ),
    },
    server: {
      open: true,
      headers: buildSecurityHeaders(BACKEND_URL, true),
    },
    preview: {
      headers: buildSecurityHeaders(BACKEND_URL, false),
    },
    optimizeDeps: {
      // `entries: []` wyłącza SKAN wstępny, więc zależności są odkrywane dopiero
      // przy pierwszym żądaniu. `@mercurjs/vendor` jest tu jawnie, żeby po każdym
      // unieważnieniu cache (np. zmianie adresu backendu) prebundling zrobił się
      // OD RAZU, zamiast wymuszać odkrycie w locie i pełne przeładowanie strony.
      entries: [],
      include: ["recharts", "@mercurjs/vendor"],
      esbuildOptions: {
        plugins: [mercurVirtualEsbuildPlugin(virtualModules)],
      },
    },
    // v1.15.0 Story 5.5 (AC1/AC2/AC4): testy renderujące realne komponenty
    // panelu. `@medusajs/ui` publikuje ESM z importami katalogowymi, których
    // Node nie rozwiązuje — bez zainlinowania przez vite każdy test dotykający
    // warstwy UI wywala się na etapie zbierania, czyli NIE MIERZY niczego.
    // Środowisko `jsdom` jest włączane PER PLIK dyrektywą
    // `// @vitest-environment jsdom`, a nie globalnie: istniejące testy
    // (m.in. `security-detail.spec.tsx`) celowo stubują `document`/`window`
    // pod środowiskiem `node` i globalne jsdom zmieniłoby to, co mierzą.
    test: {
      // Alias TYLKO na czas testów (nie dotyka builda aplikacji): wariant CJS
      // ma jawne ścieżki plików, więc nie wpada w import katalogowy.
      alias: {
        "@medusajs/ui": requireFromHere.resolve("@medusajs/ui"),
      },
      server: {
        deps: {
          inline: [/@medusajs/, /@mercurjs/],
        },
      },
    },
  } as UserConfig
}
