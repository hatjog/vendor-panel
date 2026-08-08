/**
 * voucher-client — wywołania tras realizacji vouchera z panelu salonu
 * (v1.15.0 Story 5.8, AC2/AC6/AC7).
 *
 * == Dlaczego nie `fetchQuery` ==
 * Trasy `/vendor/vouchers/:code/{lookup,redeem}` są ZWOLNIONE z bramki HMAC
 * i uwierzytelnia je łańcuch Mercura (`authenticate("member", …)` +
 * `ensureSellerMiddleware`). `ensureSellerMiddleware` czyta `seller_id`
 * z nagłówka `x-seller-id` **albo z SESJI**, a `fetchQuery` nie wysyła ciasteczek
 * (`credentials` domyślnie `same-origin`, a backend bywa na innym originie).
 * Ten klient dokłada `credentials: "include"` — tak samo, jak robi to od dawna
 * widget `competitive-insights`, jedyna inna powierzchnia panelu stojąca na tym
 * samym transporcie.
 *
 * Poza tym `fetchQuery` gubi z odpowiedzi błędu pola `code` i `reason`, a od
 * 5.8 to WŁAŚNIE ONE niosą rozróżnialny powód odmowy (UX-DR9). Zamiana samego
 * `fetchQuery` dotknęłaby każdego wywołania w panelu; osobny klient dotyka
 * jednego ekranu.
 */
/**
 * `__BACKEND_URL__` / `__PUBLISHABLE_API_KEY__` czytane LENIWIE i wprost,
 * a nie przez `import { backendUrl } from "./client"`.
 *
 * Powód zmierzony: `./client` konstruuje w module scope klienta `@medusajs/js-sdk`,
 * więc sam import wciąga cały SDK do każdego środowiska, które ten plik ładuje —
 * łącznie z jsdom-em testów, gdzie konstruktor pada. Ta zależność nie jest tu
 * potrzebna do niczego: potrzebne są DWIE wartości, nie klient SDK.
 */
declare const __BACKEND_URL__: string | undefined
declare const __PUBLISHABLE_API_KEY__: string | undefined

function resolveBackendUrl(): string {
  return typeof __BACKEND_URL__ === "string" ? __BACKEND_URL__ : "/"
}

function resolvePublishableApiKey(): string {
  return typeof __PUBLISHABLE_API_KEY__ === "string" ? __PUBLISHABLE_API_KEY__ : ""
}

/** Błąd HTTP niosący MASZYNOWY powód odmowy, nie tylko tekst. */
export class VoucherApiError extends Error {
  readonly status: number
  readonly code: string | null
  /** `already_redeemed` | `withdrawn` | `expired` | `not_redeemable` | null */
  readonly reason: string | null

  constructor(
    status: number,
    code: string | null,
    reason: string | null,
    message: string
  ) {
    super(message)
    this.name = "VoucherApiError"
    this.status = status
    this.code = code
    this.reason = reason
  }
}

function readAuthToken(): string {
  try {
    return window.localStorage.getItem("medusa_auth_token") ?? ""
  } catch {
    return ""
  }
}

export async function voucherFetch(
  path: string,
  init: { method: "GET" | "POST"; headers?: Record<string, string> }
): Promise<Record<string, unknown>> {
  const response = await fetch(`${resolveBackendUrl()}${path}`, {
    method: init.method,
    // Sesja sprzedawcy Mercura — bez niej `ensureSellerMiddleware` nie ma
    // z czego wziąć `seller_id` i żądanie nie dochodzi do handlera.
    credentials: "include",
    headers: {
      authorization: `Bearer ${readAuthToken()}`,
      "Content-Type": "application/json",
      "x-publishable-api-key": resolvePublishableApiKey(),
      ...(init.headers ?? {}),
    },
  })

  if (!response.ok) {
    // Ciało odmowy bywa puste (np. 502 z proxy) — brak JSON-a nie może
    // zamienić odmowy w wyjątek parsera bez statusu.
    let body: Record<string, unknown> = {}
    try {
      body = (await response.json()) as Record<string, unknown>
    } catch {
      body = {}
    }
    throw new VoucherApiError(
      response.status,
      typeof body.code === "string" ? body.code : null,
      typeof body.reason === "string" ? body.reason : null,
      typeof body.message === "string" ? body.message : `HTTP ${response.status}`
    )
  }

  return (await response.json()) as Record<string, unknown>
}

/**
 * Klucz idempotencji GENEROWANY PO STRONIE KLIENTA (UX-DR8, ADR-178 §2.2 M4).
 *
 * Musi powstać RAZ, przed pierwszą próbą, i NIE ZMIENIĆ SIĘ przy ponowieniu —
 * inaczej powtórka po utracie sieci wygląda dla serwera jak nowe żądanie:
 * `ON CONFLICT DO NOTHING` nie konfliktuje, powstaje drugi wiersz kanoniczny
 * i saldo schodzi drugi raz. Dlatego generator NIE MOŻE być wołany w renderze
 * ani w obsłudze kliknięcia.
 *
 * `crypto.randomUUID` jest dostępny w każdej przeglądarce wspieranej przez
 * panel; fallback istnieje dla kontekstów bez `crypto` (starsze jsdom
 * w testach), a nie „na wszelki wypadek".
 */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID()
  }
  if (c && typeof c.getRandomValues === "function") {
    const bytes = c.getRandomValues(new Uint8Array(16))
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  }
  throw new Error(
    "brak generatora losowości — klucz idempotencji musi być losowy, " +
      "a przewidywalny klucz jest gorszy niż jego brak"
  )
}
