/**
 * Tożsamość salonu dla żądań panelu — JEDEN nośnik dla całego panelu.
 *
 * == Dlaczego to istnieje ==
 * `ensureSellerMiddleware` (`@mercurjs/core`) wymaga na trasach `/vendor/*`
 * kontekstu salonu i bierze go z `x-seller-id` **albo** z `req.session.seller_id`.
 * Sesyjny nośnik zapisuje wyłącznie `POST /vendor/sellers/select`, której panel
 * nigdy nie wołał — więc do DW-15-170 KAŻDE żądanie panelu po zalogowaniu
 * odbijało się o `400 not_allowed: "x-seller-id header is required for vendor
 * routes"`, a panel wracał na `/login`. Zmierzone realną przeglądarką 2026-08-11.
 *
 * == Dlaczego nagłówek, a nie sesja ==
 * Ciasteczko sesji nie jest opcją dla realnej konfiguracji dev: panel bywa
 * otwierany spod `localhost:5174`, a backend stoi pod adresem LAN — to są
 * RÓŻNE site'y, więc ciasteczko wymagałoby `SameSite=None; Secure`, czyli
 * HTTPS-a, którego dev nie ma. Nagłówek działa identycznie spod `localhost`
 * i spod LAN-u, co ma znaczenie, bo bramka wartości 6.4 wykonywana jest
 * z telefonu, a diagnozowana z komputera.
 *
 * == To NIE jest zaufanie nagłówkowi ==
 * `ensureSellerMiddleware` weryfikuje po stronie serwera członkostwo
 * `(seller_id, member_id)` w `seller_member` i odrzuca nie-członka. Nagłówek
 * WSKAZUJE salon, nie nadaje uprawnienia. Wartość pochodzi z
 * `GET /vendor/sellers`, które samo filtruje po `req.auth_context.actor_id`,
 * więc panel może wskazać wyłącznie salon, do którego zalogowany członek należy.
 */
export const SELLER_ID_HEADER = "x-seller-id"

const STORAGE_KEY = "gp_vendor_seller_id"

export function getStoredSellerId(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? ""
  } catch {
    return ""
  }
}

export function setStoredSellerId(sellerId: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, sellerId)
  } catch {
    // Brak dostępu do localStorage nie może wywalić logowania — żądania po
    // prostu pójdą bez nagłówka i odbiją się o middleware z czytelnym 400,
    // zamiast wywalić się wcześniej z komunikatem o storage.
  }
}

export function clearStoredSellerId(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // jw.
  }
}
