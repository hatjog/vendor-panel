import Medusa from '@medusajs/js-sdk';
import { PanelResponseError, errorFromResponse, networkFailure, readJsonSuccess } from './response-class';
import { SELLER_ID_HEADER, getStoredSellerId } from './seller-context';

export const backendUrl = __BACKEND_URL__ ?? '/';
export const publishableApiKey = __PUBLISHABLE_API_KEY__ ?? '';

/**
 * Decode the JWT payload segment.
 *
 * cc-4 finding F-17: base64url uses `-` `_` and may omit padding; raw
 * `atob` throws on these, returns null, isTokenExpired returns true, and
 * the user is unexpectedly logged out. Normalise to standard base64
 * before decoding.
 */
const decodeJwt = (token: string) => {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (b64.length % 4)) % 4;
    const padded = b64 + '='.repeat(padLen);
    return JSON.parse(atob(padded));
  } catch (err) {
    return null;
  }
};

const isTokenExpired = (token: string | null) => {
  if (!token) return true;

  const payload = decodeJwt(token);
  if (!payload?.exp) return true;

  return payload.exp * 1000 < Date.now();
};

export const sdk = new Medusa({
  baseUrl: backendUrl,
  publishableKey: publishableApiKey
});

// useful when you want to call the BE from the console and try things out quickly
// cc-4 finding F-09: gate this on non-production so the convenience handle
// does not leak the SDK + in-flight auth token into prod XSS surfaces.
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (window as any).__sdk = sdk;
}

export const importProductsQuery = async (file: File) => {
  const formData = new FormData();
  formData.append('file', file);

  const bearer = window.localStorage.getItem('medusa_auth_token') || '';

  return await fetch(`${backendUrl}/vendor/products/import`, {
    method: 'POST',
    body: formData,
    headers: {
      authorization: `Bearer ${bearer}`,
      'x-publishable-api-key': publishableApiKey
    }
  })
    // v1.16.0 Story 5.2 (AC2): klasyfikowany blad zamiast `.catch(() => null)`.
    .then(readClassified, rejectAsNetworkFailure);
};

export const uploadFilesQuery = async (files: any[]) => {
  const formData = new FormData();

  for (const { file } of files) {
    formData.append('files', file);
  }

  const bearer = window.localStorage.getItem('medusa_auth_token') || '';

  return await fetch(`${backendUrl}/vendor/uploads`, {
    method: 'POST',
    body: formData,
    headers: {
      authorization: `Bearer ${bearer}`,
      'x-publishable-api-key': publishableApiKey
    }
  })
    // v1.16.0 Story 5.2 (AC2): klasyfikowany blad zamiast `.catch(() => null)`.
    .then(readClassified, rejectAsNetworkFailure);
};

/**
 * v1.16.0 Story 5.2 (AC2): upload/import ended with `.catch(() => null)` —
 * a 404 HTML page, a refusal and a backend crash all became `null`, which the
 * callers destructure (`const { files } = ...`) into a TypeError far from the
 * cause. Both now share the classified path of `fetchQuery`. These helpers sit
 * below their callers on purpose: the route inventory of Story 5.1 anchors the
 * `fetch` literals above by line (DW-15-294 regenerates it at close-out).
 */
const readClassified = async (response: Response) => {
  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  return readJsonSuccess(response);
};

const rejectAsNetworkFailure = (cause: unknown): never => {
  throw networkFailure(cause);
};

export {
  PanelResponseError,
  isPanelResponseError,
  responseClassOf,
  type ResponseClass
} from './response-class';


export const fetchQuery = async (
  url: string,
  {
    method,
    body,
    query,
    headers
  }: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: object;
    query?: Record<string, string | number | object>;
    headers?: { [key: string]: string };
  }
) => {
  const bearer = (await window.localStorage.getItem('medusa_auth_token')) || '';
  // DW-15-170: kontekst salonu dla `ensureSellerMiddleware`. Pusty przed
  // zalogowaniem i na trasach, ktore go nie wymagaja (`GET /vendor/sellers`) —
  // wtedy naglowka nie ma w ogole, zamiast wysylac pusta wartosc.
  const sellerId = getStoredSellerId();
  const params = Object.entries(query || {}).reduce((acc, [key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      if (Array.isArray(value)) {
        // Send arrays as multiple query parameters with bracket notation
        // This allows backends to parse them as arrays: status[]=draft&status[]=published
        const arrayParams = value
          .map(item => `${encodeURIComponent(key)}[]=${encodeURIComponent(item)}`)
          .join('&');
        if (acc) {
          acc += '&' + arrayParams;
        } else {
          acc = arrayParams;
        }
      } else {
        const separator = acc ? '&' : '';
        const serializedValue = typeof value === 'object' ? JSON.stringify(value) : value;
        acc += `${separator}${encodeURIComponent(key)}=${encodeURIComponent(serializedValue)}`;
      }
    }
    return acc;
  }, '');

  const response = await fetch(`${backendUrl}${url}${params && `?${params}`}`, {
    method: method,
    headers: {
      authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      'x-publishable-api-key': publishableApiKey,
      ...(sellerId ? { [SELLER_ID_HEADER]: sellerId } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : null
  }).catch(cause => {
    throw networkFailure(cause);
  });

  if (!response.ok) {
    // DW-15-172: cialo odmowy NIE ZAWSZE jest JSON-em. `404` z routera Medusy
    // przychodzi jako strona HTML, a bezwarunkowe `.json()` rzucalo wtedy
    // `SyntaxError: Unexpected token '<'` — blad PARSERA, ktory omija cala
    // obsluge statusow nizej i lecial do React Error Boundary. Skutek zmierzony:
    // jedna nieistniejaca trasa (`/vendor/me`) wywracala KAZDY ekran panelu
    // komunikatem "An unexpected error occurred while rendering this page".
    // v1.16.0 Story 5.2 (AC2): blad niesie `status` ORAZ klase odpowiedzi
    // (`route_missing` | `forbidden` | `backend_failure` | `request_rejected`).
    const error = await errorFromResponse(response);

    if (response.status === 401) {
      if (isTokenExpired(bearer)) {
        localStorage.removeItem('medusa_auth_token');
        window.location.href = '/login?reason=Unauthorized';
        return;
      }

      // Przed 5.2 rzucany byl goly obiekt `{ type: 'NO_PERMISSION' }` BEZ
      // `status` — odmowa byla nieodroznialna od kazdego innego bledu.
      throw new PanelResponseError({
        status: 401,
        statusText: error.statusText,
        responseClass: 'forbidden',
        message: error.message || 'Unauthorized',
        code: 'NO_PERMISSION'
      });
    }

    throw error;
  }

  // v1.16.0 Story 5.2 (AC2): sciezka SUKCESU tez odrzuca nie-JSON. `200`
  // z `text/html` (np. `index.html` panelu, gdy `__BACKEND_URL__` wskazuje
  // zly host w LAN) dawal `SyntaxError` parsera; teraz `bad_format` ze statusem.
  return readJsonSuccess(response);
};
