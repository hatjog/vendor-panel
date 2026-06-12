import Medusa from '@medusajs/js-sdk';

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
    .then(res => res.json())
    .catch(() => null);
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
    .then(res => res.json())
    .catch(() => null);
};

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
      ...headers
    },
    body: body ? JSON.stringify(body) : null
  });

  if (!response.ok) {
    const errorData = await response.json();

    if (response.status === 401) {
      if (isTokenExpired(bearer)) {
        localStorage.removeItem('medusa_auth_token');
        window.location.href = '/login?reason=Unauthorized';
        return;
      }

      throw {
        type: 'NO_PERMISSION',
        message: errorData.message || 'Unauthorized'
      };
    }

    const error = new Error(errorData.message || 'Server error');
    (error as Error & { status: number }).status = response.status;
    throw error;
  }

  return response.json();
};
