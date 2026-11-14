// @vitest-environment jsdom
/**
 * Kontrakt absolutnych wywołań upload/import jest mierzony na parametrze
 * przekazywanym do `fetch`, nie na deklaracji inwentarza. Usunięcie bearer
 * albo publishable key musi natychmiast zaczerwienić ten test.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@medusajs/js-sdk', () => ({
  default: class Medusa {},
}))

import { fetchQuery, importProductsQuery, uploadFilesQuery } from '../client'
import { PanelResponseError, type ResponseClass } from '../response-class'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'medusa_auth_token' ? 'tok_1' : null),
    setItem: () => undefined,
    removeItem: () => undefined,
  })
})

function headersOf(contentType: string | null) {
  return { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) }
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: headersOf('application/json; charset=utf-8'),
    json: async () => body,
  }
}

const HTML = '<!doctype html><html><body>Cannot GET /vendor/x</body></html>'

function htmlResponse(status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 404 ? 'Not Found' : status === 502 ? 'Bad Gateway' : 'OK',
    headers: headersOf('text/html; charset=utf-8'),
    json: async () => JSON.parse(HTML),
  }
}

function expectAbsoluteBackendAuth(path: string) {
  const [target, init] = fetchMock.mock.calls[0]
  const headers = init.headers as Record<string, string>

  expect(String(target)).toContain(path)
  expect(init.method).toBe('POST')
  expect(headers.authorization).toBe('Bearer tok_1')
  expect(headers['x-publishable-api-key']).toBe('')
  expect(init.credentials).toBeUndefined()
}

describe('absolutne fetch do backendu — kontrakt transportu', () => {
  it('import produktów wysyła bearer i publishable key', async () => {
    await importProductsQuery(new File(['product'], 'product.csv', { type: 'text/csv' }))

    expectAbsoluteBackendAuth('/vendor/products/import')
  })

  it('upload plików wysyła bearer i publishable key', async () => {
    await uploadFilesQuery([
      { file: new File(['image'], 'image.png', { type: 'image/png' }) },
    ])

    expectAbsoluteBackendAuth('/vendor/uploads')
  })
})

/**
 * v1.16.0 Story 5.2 (AC2): każda odpowiedź, której panel nie może użyć jako
 * danych, kończy się błędem z `status` ORAZ klasą odpowiedzi. Asercje są na
 * WARTOŚCIACH, które wypływają do ekranu (`status`, `responseClass`), więc
 * mutant zlewający dwie klasy (np. 404 → `backend_failure`) czerwieni test.
 */
async function capture(promise: Promise<unknown>): Promise<PanelResponseError> {
  const outcome = await promise.then(
    value => ({ value }),
    error => ({ error })
  )
  if (!('error' in outcome)) {
    throw new Error(`oczekiwano odrzucenia, a przyszło: ${JSON.stringify(outcome.value)}`)
  }
  expect(outcome.error).toBeInstanceOf(PanelResponseError)
  return outcome.error as PanelResponseError
}

const CASES: Array<{
  name: string
  response: () => unknown
  status: number
  responseClass: ResponseClass
}> = [
  { name: '404 ze stroną HTML (brak trasy)', response: () => htmlResponse(404), status: 404, responseClass: 'route_missing' },
  { name: '403 z ciałem JSON (odmowa)', response: () => jsonResponse(403, { type: 'not_allowed', message: 'nope' }), status: 403, responseClass: 'forbidden' },
  { name: '500 z ciałem JSON (awaria backendu)', response: () => jsonResponse(500, { message: 'boom' }), status: 500, responseClass: 'backend_failure' },
  { name: '502 ze stroną HTML proxy (awaria backendu)', response: () => htmlResponse(502), status: 502, responseClass: 'backend_failure' },
  { name: '200 z text/html na ścieżce sukcesu (zły format)', response: () => htmlResponse(200), status: 200, responseClass: 'bad_format' },
]

describe('fetchQuery — rozróżnialny błąd zamiast pustki (5.2 AC2)', () => {
  for (const c of CASES) {
    it(`${c.name}: status ${c.status}, klasa ${c.responseClass}`, async () => {
      fetchMock.mockResolvedValueOnce(c.response())

      const error = await capture(fetchQuery('/vendor/products', { method: 'GET' }))

      expect(error.status).toBe(c.status)
      expect(error.responseClass).toBe(c.responseClass)
    })
  }

  it('200 bez nagłówka content-type, ale z ciałem nie-JSON: bad_format, nie SyntaxError', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: headersOf(null),
      json: async () => JSON.parse(HTML),
    })

    const error = await capture(fetchQuery('/vendor/products', { method: 'GET' }))

    expect(error.status).toBe(200)
    expect(error.responseClass).toBe('bad_format')
  })

  it('200 z JSON-em zwraca dane bez zmian', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { products: [], count: 0 }))

    await expect(fetchQuery('/vendor/products', { method: 'GET' })).resolves.toEqual({
      products: [],
      count: 0,
    })
  })

  it('401 przy ważnym tokenie niesie status i klasę forbidden (przed 5.2: obiekt bez status)', async () => {
    const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === 'medusa_auth_token' ? `h.${payload}.s` : null),
      setItem: () => undefined,
      removeItem: () => undefined,
    })
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' }))

    const error = await capture(fetchQuery('/vendor/products', { method: 'GET' }))

    expect(error.status).toBe(401)
    expect(error.responseClass).toBe('forbidden')
    expect(error.code).toBe('NO_PERMISSION')
  })

  it('odrzucony fetch (backend nieosiągalny): status 0, klasa backend_failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const error = await capture(fetchQuery('/vendor/products', { method: 'GET' }))

    expect(error.status).toBe(0)
    expect(error.responseClass).toBe('backend_failure')
  })

  it('cztery klasy AC2 są parami różne (mutant zlewający dwie klasy = czerwono)', async () => {
    const seen = new Set<ResponseClass>()
    for (const c of CASES.filter(c => c.status !== 502)) {
      fetchMock.mockResolvedValueOnce(c.response())
      seen.add((await capture(fetchQuery('/vendor/x', { method: 'GET' }))).responseClass)
    }
    expect([...seen].sort()).toEqual(['backend_failure', 'bad_format', 'forbidden', 'route_missing'])
  })
})

describe('upload/import — koniec cichego `null` (5.2 AC2)', () => {
  it('upload na 404 HTML odrzuca route_missing zamiast zwracać null', async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse(404))

    const error = await capture(
      uploadFilesQuery([{ file: new File(['image'], 'image.png', { type: 'image/png' }) }])
    )

    expect(error.status).toBe(404)
    expect(error.responseClass).toBe('route_missing')
  })

  it('import na 200 text/html odrzuca bad_format', async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse(200))

    const error = await capture(
      importProductsQuery(new File(['product'], 'product.csv', { type: 'text/csv' }))
    )

    expect(error.responseClass).toBe('bad_format')
  })

  it('import przy nieosiągalnym backendzie odrzuca backend_failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const error = await capture(
      importProductsQuery(new File(['product'], 'product.csv', { type: 'text/csv' }))
    )

    expect(error.status).toBe(0)
    expect(error.responseClass).toBe('backend_failure')
  })
})
