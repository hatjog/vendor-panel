/**
 * voucher-client — wywołania tras realizacji vouchera z panelu salonu
 * (v1.15.0 Story 5.8, AC2/AC6/AC7).
 *
 * == Dlaczego nie `fetchQuery` ==
 * Trasy `/vendor/vouchers/:code/{lookup,redeem}` są ZWOLNIONE z bramki HMAC
 * i uwierzytelnia je łańcuch Mercura (`authenticate("member", …)` +
 * `ensureSellerMiddleware`). `ensureSellerMiddleware` czyta `seller_id`
 * z nagłówka `x-seller-id` **albo z SESJI**, a `fetchQuery` nie wysyła ani
 * jednego, ani drugiego (`credentials` domyślnie `same-origin`, a backend bywa
 * na innym originie). Ten klient wysyła `x-seller-id` JAWNIE (patrz
 * {@link SELLER_ID_HEADER} — sesyjnego `seller_id` nie zapisuje w panelu nic,
 * bo `POST /vendor/sellers/select` nie jest nigdzie wołane) i dokłada
 * `credentials: "include"` jako nośnik zapasowy.
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

/**
 * Nagłówek tożsamości salonu wymagany przez `ensureSellerMiddleware`
 * (`@mercurjs/core`, `api/utils/ensure-seller-middleware.ts`).
 *
 * == Dlaczego JEST WYSYŁANY JAWNIE (review-fix cyklu 1, finding HIGH) ==
 * Middleware bierze `seller_id` z `x-seller-id` **albo** z `req.session.seller_id`,
 * a sesyjny nośnik zapisuje WYŁĄCZNIE trasa `POST /vendor/sellers/select`,
 * której panel nigdy nie woła (zmierzone `grep`-em po ZAINICJALIZOWANYM
 * submodule, nie po pustym katalogu). Poleganie na samym `credentials: "include"`
 * oznaczało więc, że każde żądanie tego ekranu odbija się o `NOT_ALLOWED`
 * („x-seller-id header is required for vendor routes”) — czyli `401` sprzed 5.8
 * zamieniało się na odmowę z innego miejsca, a kontrola dodatnia AC3 przechodziła
 * tylko dlatego, że skrypt `curl` podstawiał ten nagłówek ręcznie.
 *
 * To NIE JEST zaufanie nagłówkowi: `ensureSellerMiddleware` weryfikuje po
 * stronie serwera członkostwo `(seller_id, member_id)` w `seller_member`
 * i odrzuca nie-członka. Nagłówek WSKAZUJE salon, nie nadaje uprawnienia.
 */
// Stala mieszka w `seller-context.ts` — jest wspolna dla CALEGO panelu, a nie
// tylko dla ekranu vouchera (DW-15-170). Re-eksport zachowuje istniejacych
// importerow (m.in. testy) bez tworzenia drugiej definicji.
export { SELLER_ID_HEADER } from "./seller-context"

export async function voucherFetch(
  path: string,
  init: {
    method: "GET" | "POST"
    /** Salon, w którego zakresie działa ekran — z `useMe()`. */
    sellerId: string
    headers?: Record<string, string>
  }
): Promise<Record<string, unknown>> {
  const response = await fetch(`${resolveBackendUrl()}${path}`, {
    method: init.method,
    // Sesja sprzedawcy Mercura zostaje jako DRUGI, zapasowy nośnik (gdyby
    // panel kiedyś zaczął wołać `/vendor/sellers/select`), ale nie jest już
    // jedynym — patrz komentarz przy `SELLER_ID_HEADER`.
    credentials: "include",
    headers: {
      authorization: `Bearer ${readAuthToken()}`,
      "Content-Type": "application/json",
      "x-publishable-api-key": resolvePublishableApiKey(),
      [SELLER_ID_HEADER]: init.sellerId,
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
