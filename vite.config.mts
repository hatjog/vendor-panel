import { defineConfig } from "vite"

import { createVendorPanelViteConfig } from "./src/dev/vite-config"

// https://vitejs.dev/config/
//
// Cała treść konfiguracji leży w `src/dev/vite-config.ts`. Powód jest mierzalny,
// nie estetyczny: ten plik należy wyłącznie do projektu composite
// `tsconfig.node.json`, więc każdy import z `src/` kończył się `TS6305` i pakiet
// testów nie mógł asertować realnej konfiguracji (DW-15-162).
export default defineConfig(createVendorPanelViteConfig)
