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

  it("simulates prod bundler substitution: __sdk block is dead code when DEV=false", () => {
    // Simulate what tsup does: replace import.meta.env.DEV with false
    // (minifySyntax: true then eliminates the dead branch)
    const prodSimulated = clientSource.replace(
      /import\.meta\.env\.DEV/g,
      "false",
    )
    // After substitution the condition becomes: typeof window !== "undefined" && false
    // which is always false — so a naive evaluator eliminates the branch.
    // We assert that the __sdk assignment only appears inside the DEV-gated block
    // (i.e. no __sdk assignment outside the gated if-block).
    const sdkBlockMatch = prodSimulated.match(
      /if\s*\(\s*typeof window !== ['"]undefined['"]\s*&&\s*false\s*\)\s*\{([^}]*)\}/s,
    )
    expect(sdkBlockMatch).not.toBeNull()

    // Remove the dead block from source — what remains must NOT contain __sdk
    const outsideBlock = prodSimulated.replace(
      /if\s*\(\s*typeof window !== ['"]undefined['"]\s*&&\s*false\s*\)\s*\{[^}]*\}/gs,
      "",
    )
    expect(outsideBlock).not.toContain("__sdk")
  })
})
