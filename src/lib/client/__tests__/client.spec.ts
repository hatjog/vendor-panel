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

import { importProductsQuery, uploadFilesQuery } from '../client'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ json: async () => ({ ok: true }) })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (key === 'medusa_auth_token' ? 'tok_1' : null),
    setItem: () => undefined,
    removeItem: () => undefined,
  })
})

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
