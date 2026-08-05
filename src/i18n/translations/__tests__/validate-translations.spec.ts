import fs from "fs"
import path from "path"
import { describe, expect, test } from "vitest"

import schema from "../$schema.json"
import {
  VOUCHER_STATUSES,
  VOUCHER_STATUS_I18N_KEYS,
} from "../../voucher-state-vocabulary"

const translationsDir = path.join(__dirname, "..")

function getRequiredKeysFromSchema(schema: any, prefix = ""): string[] {
  const keys: string[] = []

  if (schema.type === "object" && schema.properties) {
    Object.entries(schema.properties).forEach(([key, value]: [string, any]) => {
      const newPrefix = prefix ? `${prefix}.${key}` : key
      if (value.type === "object") {
        keys.push(...getRequiredKeysFromSchema(value, newPrefix))
      } else {
        keys.push(newPrefix)
      }
    })
  }

  return keys.sort()
}

function getTranslationKeys(obj: any, prefix = ""): string[] {
  const keys: string[] = []

  Object.entries(obj).forEach(([key, value]) => {
    const newPrefix = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === "object") {
      keys.push(...getTranslationKeys(value, newPrefix))
    } else {
      keys.push(newPrefix)
    }
  })

  return keys.sort()
}

describe("translation schema validation", () => {
  test("en.json should have all keys defined in schema", () => {
    const enPath = path.join(translationsDir, "en.json")
    const enTranslations = JSON.parse(fs.readFileSync(enPath, "utf-8"))

    const schemaKeys = getRequiredKeysFromSchema(schema)
    const translationKeys = getTranslationKeys(enTranslations)

    const missingInTranslations = schemaKeys.filter(
      (key) => !translationKeys.includes(key)
    )
    const extraInTranslations = translationKeys.filter(
      (key) => !schemaKeys.includes(key)
    )

    if (missingInTranslations.length > 0) {
      console.error("\nMissing keys in en.json:", missingInTranslations)
    }
    if (extraInTranslations.length > 0) {
      console.error("\nExtra keys in en.json:", extraInTranslations)
    }

    expect(missingInTranslations).toEqual([])
    expect(extraInTranslations).toEqual([])
  })
})

/**
 * v1.15.0 Story 5.5 (AC2/AC3) — ROZSZERZENIE istniejącej bramki, nie drugi
 * nośnik tej samej reguły.
 *
 * Powyższy test pilnuje wyłącznie `en.json` względem schemy. To za mało dla
 * tej story: klucz może istnieć w `en.json`, mieć wpis w schemie i mimo to
 * NIE MIEĆ polskiego tłumaczenia — użytkownik dostaje wtedy cichy angielski
 * fallback, czyli dokładnie stan zastany („zero wystąpień słowa »voucher«
 * w `pl.json`"). Poniższe testy domykają dwie luki:
 *
 *   1. KAŻDY klucz z gałęzi `voucher.*` ma NIEPUSTĄ wartość w `pl.json`
 *      i w `en.json`, a zbiory kluczy obu plików w tej gałęzi są identyczne.
 *   2. Zbiór stanów w `voucher.status.*` odpowiada lustru słownika
 *      (`src/i18n/voucher-state-vocabulary.ts`) — brak i nadmiar są tym samym
 *      defektem. Parity tego lustra z kontraktem w superprojekcie
 *      (`specs/contracts/redemption/voucher-state-vocabulary.v1.yaml`) pilnuje
 *      bramka `_grow/tools/validate_vendor_panel_voucher_i18n.py`, bo tamten
 *      plik nie jest widoczny z wnętrza submodułu.
 */
describe("voucher i18n parity (v1.15.0 Story 5.5)", () => {
  const load = (file: string) =>
    JSON.parse(fs.readFileSync(path.join(translationsDir, file), "utf-8"))

  const voucherKeys = (obj: any) =>
    getTranslationKeys(obj.voucher ?? {}).map((k) => `voucher.${k}`)

  const valueAt = (obj: any, dotted: string) =>
    dotted.split(".").reduce((acc: any, part) => acc?.[part], obj)

  test("pl.json i en.json mają IDENTYCZNY zbiór kluczy w gałęzi voucher.*", () => {
    const pl = voucherKeys(load("pl.json"))
    const en = voucherKeys(load("en.json"))

    expect(pl.length).toBeGreaterThan(0)
    expect(pl.filter((k) => !en.includes(k))).toEqual([])
    expect(en.filter((k) => !pl.includes(k))).toEqual([])
  })

  test("każdy klucz voucher.* ma niepustą wartość w pl.json i en.json", () => {
    for (const file of ["pl.json", "en.json"]) {
      const translations = load(file)
      const empty = voucherKeys(translations).filter((key) => {
        const value = valueAt(translations, key)
        return typeof value !== "string" || value.trim().length === 0
      })
      expect({ file, empty }).toEqual({ file, empty: [] })
    }
  })

  test("zbiór stanów w voucher.status.* == lustro słownika stanów", () => {
    const expected = [...VOUCHER_STATUSES, "unknown"].sort()
    for (const file of ["pl.json", "en.json"]) {
      const actual = Object.keys(load(file).voucher.status).sort()
      expect({ file, actual }).toEqual({ file, actual: expected })
    }
  })

  test("klucze i18n stanów w lustrze pokrywają się z gałęzią voucher.status.*", () => {
    const pl = load("pl.json")
    for (const status of VOUCHER_STATUSES) {
      const key = VOUCHER_STATUS_I18N_KEYS[status]
      expect(key).toBe(`voucher.status.${status}`)
      expect(typeof valueAt(pl, key)).toBe("string")
    }
  })
})
