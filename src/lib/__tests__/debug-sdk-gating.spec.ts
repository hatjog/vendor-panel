// @vitest-environment node
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSource = readFileSync(resolve(__dirname, "../client/client.ts"), "utf8")
const tsupConfigSource = readFileSync(resolve(__dirname, "../../../tsup.config.cjs"), "utf8")

describe("debug SDK handle gating", () => {
  it("exposes window.__sdk only behind Vite DEV flag", () => {
    expect(clientSource).toContain("import.meta.env.DEV")
    expect(clientSource).toMatch(
      /if\s*\(\s*typeof window !== ['"]undefined['"]\s*&&\s*import\.meta\.env\.DEV\s*\)\s*\{[^}]*__sdk\s*=\s*sdk/s,
    )
  })

  it("does not use process.env production checks for the browser debug handle", () => {
    expect(clientSource).not.toContain("process.env")
    expect(clientSource).not.toContain("NODE_ENV")
  })

  it("defines DEV as false for tsup production package builds", () => {
    expect(tsupConfigSource).toContain('"import.meta.env.DEV": "false"')
    expect(tsupConfigSource).toContain("minifySyntax: true")
  })
})
