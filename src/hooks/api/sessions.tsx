import { useMutation, useQuery } from '@tanstack/react-query';

import { backendUrl, publishableApiKey } from '../../lib/client';
import { queryClient } from '../../lib/query-client';

export type VendorSession = {
  jti: string;
  device_class: string;
  last_active: string;
  ip_region: string | null;
  current_session: boolean;
};

export type VendorSessionsResponse = {
  sessions: VendorSession[];
};

export type RevokeVendorSessionInput = {
  jti: string;
  current_session: boolean;
};

export type RevokeVendorSessionResponse = {
  revoked_at: string;
};

export type VendorSessionErrorKind = 'generic' | 'rate_limited' | 'server' | 'unknown';

export class VendorSessionApiError extends Error {
  status: number;
  kind: VendorSessionErrorKind;
  retryAfterSeconds?: number;

  constructor({
    message,
    status,
    kind,
    retryAfterSeconds
  }: {
    message: string;
    status: number;
    kind: VendorSessionErrorKind;
    retryAfterSeconds?: number;
  }) {
    super(message);
    this.name = 'VendorSessionApiError';
    this.status = status;
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const vendorSessionsQueryKeys = {
  all: ['vendor-sessions'] as const,
  list: () => [...vendorSessionsQueryKeys.all, 'list'] as const
};

export const parseRetryAfterSeconds = (
  retryAfterHeader: string | null,
  bodyRetryAfterSeconds?: unknown
) => {
  if (retryAfterHeader) {
    const parsedHeader = Number.parseInt(retryAfterHeader, 10);

    if (Number.isFinite(parsedHeader) && parsedHeader > 0) {
      return parsedHeader;
    }
  }

  if (
    typeof bodyRetryAfterSeconds === 'number' &&
    Number.isFinite(bodyRetryAfterSeconds) &&
    bodyRetryAfterSeconds > 0
  ) {
    return bodyRetryAfterSeconds;
  }

  return 20;
};

const authHeaders = () => {
  const bearer = window.localStorage.getItem('medusa_auth_token') || '';

  return {
    authorization: `Bearer ${bearer}`,
    'Content-Type': 'application/json',
    'x-publishable-api-key': publishableApiKey
  };
};

const readJson = async <TResponse,>(response: Response) => {
  try {
    return (await response.json()) as TResponse;
  } catch {
    return null;
  }
};

const buildSessionError = async (response: Response) => {
  const body = await readJson<{
    code?: string;
    message?: string;
    retry_after_seconds?: number;
  }>(response);

  if (response.status === 429) {
    return new VendorSessionApiError({
      message: 'Rate limited',
      status: response.status,
      kind: 'rate_limited',
      retryAfterSeconds: parseRetryAfterSeconds(
        response.headers.get('Retry-After'),
        body?.retry_after_seconds
      )
    });
  }

  if (response.status === 403) {
    return new VendorSessionApiError({
      message: 'Session revoke rejected',
      status: response.status,
      kind: 'generic'
    });
  }

  if (response.status >= 500) {
    return new VendorSessionApiError({
      message: body?.message || 'Server error',
      status: response.status,
      kind: 'server'
    });
  }

  return new VendorSessionApiError({
    message: body?.message || 'Session request failed',
    status: response.status,
    kind: 'unknown'
  });
};

const fetchVendorSessions = async () => {
  // TODO(8.3): upgrade to @mercurjs/vendor typed client once the package exposes vendor auth sessions HTTP methods.
  const response = await fetch(`${backendUrl}/vendor/auth/sessions`, {
    method: 'GET',
    credentials: 'include',
    headers: authHeaders()
  });

  if (!response.ok) {
    throw await buildSessionError(response);
  }

  return (await response.json()) as VendorSessionsResponse;
};

const revokeVendorSession = async (
  input: RevokeVendorSessionInput,
  retryServerError = true
): Promise<RevokeVendorSessionResponse> => {
  // TODO(8.3): upgrade to @mercurjs/vendor typed client once the package exposes vendor magic-link revoke HTTP methods.
  const response = await fetch(
    `${backendUrl}/vendor/magic-links/${encodeURIComponent(input.jti)}/revoke`,
    {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders(),
      body: JSON.stringify({
        confirm: true,
        current_session: input.current_session
      })
    }
  );

  if (!response.ok) {
    const error = await buildSessionError(response);

    if (retryServerError && error.kind === 'server') {
      return revokeVendorSession(input, false);
    }

    throw error;
  }

  return (await response.json()) as RevokeVendorSessionResponse;
};

export const useVendorSessions = () => {
  return useQuery({
    queryKey: vendorSessionsQueryKeys.list(),
    queryFn: fetchVendorSessions
  });
};

export const useRevokeVendorSession = () => {
  return useMutation({
    mutationFn: revokeVendorSession,
    onSuccess: (_data, variables) => {
      if (!variables.current_session) {
        queryClient.invalidateQueries({
          queryKey: vendorSessionsQueryKeys.list()
        });
      }
    }
  });
};
