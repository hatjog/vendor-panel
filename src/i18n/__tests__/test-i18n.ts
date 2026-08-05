/**
 * Instancja i18next dla testów — REALNA konfiguracja panelu, nie atrapa.
 *
 * Story v1.15.0 5.5 (AC2): dowodem lokalizacji ma być POLSKI NAPIS W RENDERZE,
 * a nie obecność klucza w JSON-ie. Żeby ten dowód coś znaczył, test musi
 * renderować przez tę samą konfigurację, której używa panel:
 * `defaultI18nOptions` z `src/i18n/config.ts` (te same `resources`, ten sam
 * `fallbackLng`, te same namespace'y). Atrapa `t: (k) => k` unieważniłaby
 * cały pomiar.
 *
 * Różnica wobec produkcji jest jedna i jawna: język jest USTAWIONY na wprost
 * zamiast wykrywany z ciasteczka/przeglądarki — test ma mierzyć tłumaczenia,
 * nie detektor języka.
 */

import i18n from "i18next"
import { initReactI18next } from "react-i18next"

import { defaultI18nOptions } from "../config"

export async function createTestI18n(lng = "pl") {
  const instance = i18n.createInstance()
  await instance.use(initReactI18next).init({
    ...defaultI18nOptions,
    lng,
    debug: false,
    // Klucz bez tłumaczenia MUSI być widoczny jako klucz, a nie ukryty pod
    // wartością domyślną z `t(key, "default")` — inaczej test przechodziłby
    // na angielskim fallbacku i niczego by nie mierzył.
    parseMissingKeyHandler: (key: string) => `__MISSING__${key}`,
  })
  // `createInstance()` jest typowane bez `reportNamespaces`, ale `initReactI18next`
  // ustawia to pole PRZY INICJALIZACJI (runtime), a `I18nextProvider` go wymaga
  // w typie. Asercja domyka lukę w typach biblioteki, nie brak w zachowaniu.
  return instance as typeof i18n
}
