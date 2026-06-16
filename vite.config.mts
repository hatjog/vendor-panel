import inject from "@medusajs/admin-vite-plugin"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv, type Plugin } from "vite"
import inspect from "vite-plugin-inspect"

type MercurVirtualModulesOptions = {
  backendUrl: string
  storefrontUrl: string
  base: string
}

function mercurVirtualModulesPlugin({
  backendUrl,
  storefrontUrl,
  base,
}: MercurVirtualModulesOptions): Plugin {
  const modules: Record<string, string> = {
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

  return {
    name: "gp-mercur-virtual-modules",
    resolveId(id) {
      if (Object.hasOwn(modules, id)) {
        return id
      }
    },
    load(id) {
      return modules[id]
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
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

  return {
    plugins: [
      inspect(),
      react(),
      mercurVirtualModulesPlugin({
        backendUrl: BACKEND_URL,
        storefrontUrl: STOREFRONT_URL,
        base: BASE,
      }),
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
      // Story v160-7-8: CSP headers — defense-in-depth XSS prevention (NFR-SEC-3).
      headers: {
        "Content-Security-Policy":
          "default-src 'self'; " +
          "script-src 'self' 'unsafe-eval'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data: https:; " +
          "font-src 'self' data:; " +
          `connect-src 'self' ${BACKEND_URL} ws: wss:; ` +
          "frame-ancestors 'none'; " +
          "form-action 'self'; " +
          "base-uri 'self'",
      },
    },
    optimizeDeps: {
      entries: [],
      exclude: ["@mercurjs/vendor"],
      include: ["recharts"],
    },
  }
})
