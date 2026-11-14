// @vitest-environment jsdom
/**
 * `voucherFetch` mierzony KSZTAŁTEM ŻĄDANIA, które realnie wychodzi na sieć
 * (v1.15.0 Story 5.8, AC2 — review-fix cyklu 1, finding HIGH).
 *
 * Po co ten plik istnieje: kontrola dodatnia AC3 przechodziła przez `curl`,
 * który podstawiał `-H "x-seller-id: …"` RĘCZNIE. Panel tego nagłówka nie
 * wysyłał, a sesyjnego `seller_id` nie zapisuje w panelu nic (`POST
 * /vendor/sellers/select` nie jest wołane nigdzie) — czyli mierzono kształt,
 * którego ekran nigdy nie produkuje. Ten test asertuje NAGŁÓWKI PRZEKAZANE DO
 * `fetch`, więc pęka natychmiast po usunięciu nośnika tożsamości.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

import { PanelResponseError } from "../response-class"
import { SELLER_ID_HEADER, VoucherApiError, voucherFetch } from "../voucher-client"

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  // `localStorage` podstawiane wprost: `readAuthToken` czyta je przez `window`,
  // a jsdom w tej konfiguracji nie zawsze wystawia realny magazyn.
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (key === "medusa_auth_token" ? "tok_1" : null),
    setItem: () => undefined,
    removeItem: () => undefined,
  })
})

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

function errorResponse(status: number, body: unknown) {
  return { ok: false, status, json: async () => body }
}

function headersOfLastCall(): Record<string, string> {
  return fetchMock.mock.calls[0][1].headers as Record<string, string>
}

describe("voucherFetch — nośnik tożsamości salonu", () => {
  it("wysyła `x-seller-id` z podanym salonem, a nie polega na samej sesji", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ voucher: { code: "GP-1" } }))

    await voucherFetch("/vendor/vouchers/GP-1/lookup", {
      method: "GET",
      sellerId: "sel_01ABC",
    })

    expect(headersOfLastCall()[SELLER_ID_HEADER]).toBe("sel_01ABC")
  })

  it("nie gubi pozostałych nośników transportu (bearer, publishable key, ciasteczko)", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ ok: true }))

    await voucherFetch("/vendor/vouchers/GP-1/redeem", {
      method: "POST",
      sellerId: "sel_01ABC",
      headers: { "Idempotency-Key": "key-1" },
    })

    const [, init] = fetchMock.mock.calls[0]
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe("Bearer tok_1")
    expect(headers["x-publishable-api-key"]).toBe("")
    expect(headers[SELLER_ID_HEADER]).toBe("sel_01ABC")
    expect(headers["Idempotency-Key"]).toBe("key-1")
    expect(init.credentials).toBe("include")
    expect(init.method).toBe("POST")
  })

  it("odmowa z powodem zachowuje `code` i `reason` (UX-DR9)", async () => {
    fetchMock.mockResolvedValueOnce(
      errorResponse(409, {
        code: "VOUCHER_WITHDRAWN",
        reason: "withdrawn",
        message: "voucher wycofany",
      }),
    )

    await expect(
      voucherFetch("/vendor/vouchers/GP-1/redeem", {
        method: "POST",
        sellerId: "sel_01ABC",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "VOUCHER_WITHDRAWN",
      reason: "withdrawn",
    })
  })

  it("puste ciało odmowy nie zamienia odmowy w błąd parsera bez statusu", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("not json")
      },
    })

    const error = await voucherFetch("/vendor/vouchers/GP-1/lookup", {
      method: "GET",
      sellerId: "sel_01ABC",
    }).catch((e) => e)

    expect(error).toBeInstanceOf(VoucherApiError)
    expect(error.status).toBe(502)
    expect(error.reason).toBeNull()
  })
})

/**
 * v1.16.0 Story 5.2 (AC2): `VoucherApiError` niesie TĘ SAMĄ taksonomię klas
 * co `fetchQuery`. Kontrakt backendu (`code`, `reason`) się nie zmienia.
 */
function htmlResponse(status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "text/html" : null) },
    json: async () => JSON.parse("<!doctype html>"),
  }
}

async function voucherError(response: unknown) {
  fetchMock.mockResolvedValueOnce(response)
  const error = await voucherFetch("/vendor/vouchers/GP-1/lookup", {
    method: "GET",
    sellerId: "sel_01ABC",
  }).then(
    (value) => {
      throw new Error(`oczekiwano odrzucenia: ${JSON.stringify(value)}`)
    },
    (e) => e
  )
  expect(error).toBeInstanceOf(VoucherApiError)
  expect(error).toBeInstanceOf(PanelResponseError)
  return error as VoucherApiError
}

describe("voucherFetch — klasy odpowiedzi (5.2 AC2)", () => {
  it("404 HTML: status 404, klasa route_missing", async () => {
    const error = await voucherError(htmlResponse(404))
    expect(error.status).toBe(404)
    expect(error.responseClass).toBe("route_missing")
  })

  it("403 JSON: status 403, klasa forbidden, kod zachowany", async () => {
    const error = await voucherError(
      errorResponse(403, { code: "NOT_A_MEMBER", message: "odmowa" })
    )
    expect(error.status).toBe(403)
    expect(error.responseClass).toBe("forbidden")
    expect(error.code).toBe("NOT_A_MEMBER")
  })

  it("500 JSON: status 500, klasa backend_failure", async () => {
    const error = await voucherError(errorResponse(500, { message: "boom" }))
    expect(error.status).toBe(500)
    expect(error.responseClass).toBe("backend_failure")
  })

  it("502 HTML: status 502, klasa backend_failure", async () => {
    const error = await voucherError(htmlResponse(502))
    expect(error.status).toBe(502)
    expect(error.responseClass).toBe("backend_failure")
  })

  it("200 text/html na ścieżce sukcesu: status 200, klasa bad_format", async () => {
    const error = await voucherError(htmlResponse(200))
    expect(error.status).toBe(200)
    expect(error.responseClass).toBe("bad_format")
  })

  it("409 z powodem odmowy: klasa request_rejected, reason bez zmian", async () => {
    const error = await voucherError(
      errorResponse(409, { code: "VOUCHER_WITHDRAWN", reason: "withdrawn" })
    )
    expect(error.responseClass).toBe("request_rejected")
    expect(error.reason).toBe("withdrawn")
  })

  it("odrzucony fetch: status 0, klasa backend_failure", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    const error = await voucherFetch("/vendor/vouchers/GP-1/lookup", {
      method: "GET",
      sellerId: "sel_01ABC",
    }).catch((e) => e)
    expect(error).toBeInstanceOf(VoucherApiError)
    expect(error.status).toBe(0)
    expect(error.responseClass).toBe("backend_failure")
  })
})
