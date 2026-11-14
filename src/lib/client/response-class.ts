/**
 * Response classification for every HTTP client of the panel
 * (v1.16.0 Story 5.2, AC2 — FR-18, AD-35, NFR-4, DW-15-172).
 *
 * == Why one taxonomy ==
 * Before 5.2 a failed call surfaced as one of: a plain `Error` with `status`
 * (non-2xx), a bare object `{ type: "NO_PERMISSION" }` WITHOUT `status` (401),
 * a parser `SyntaxError` (200 with an HTML body) or `null` (upload/import,
 * `.catch(() => null)`). The screen could not tell a missing route from a
 * refusal, a backend crash or a wrong backend address, so every one of them
 * collapsed into the same generic page or a false empty-state.
 *
 * Every client now throws {@link PanelResponseError}: it keeps the HTTP
 * `status` AND a machine `responseClass`. The class is derived from the
 * response, never guessed by the screen.
 *
 * Classes (AC2 names them; `request_rejected` covers the remaining 4xx that
 * are neither a missing route nor a refusal — validation, conflict):
 *   - `route_missing`    — 404 / 405: the backend has no such route,
 *   - `forbidden`        — 401 / 403: the actor is refused,
 *   - `backend_failure`  — 5xx and network failure (no response at all),
 *   - `bad_format`       — a 2xx whose body is not JSON (e.g. the panel's own
 *                          `index.html` served because `__BACKEND_URL__`
 *                          points at the wrong host — the LAN failure mode),
 *   - `request_rejected` — any other 4xx.
 *
 * The status decides the class of a non-2xx response even when its body is
 * HTML: a `404` HTML page is a missing route, not a format problem.
 */

export const RESPONSE_CLASSES = [
  "route_missing",
  "forbidden",
  "backend_failure",
  "bad_format",
  "request_rejected",
] as const

export type ResponseClass = (typeof RESPONSE_CLASSES)[number]

/** Status carried by a network failure — there was no HTTP response. */
export const NETWORK_FAILURE_STATUS = 0

export function classifyHttpStatus(status: number): ResponseClass {
  if (status === 404 || status === 405) return "route_missing"
  if (status === 401 || status === 403) return "forbidden"
  if (status >= 500 || status === NETWORK_FAILURE_STATUS) return "backend_failure"
  return "request_rejected"
}

export class PanelResponseError extends Error {
  readonly status: number
  readonly statusText: string
  readonly responseClass: ResponseClass
  /** Machine code from a JSON error body, when the backend sent one. */
  readonly code: string | null

  constructor(init: {
    status: number
    statusText?: string
    responseClass: ResponseClass
    message: string
    code?: string | null
  }) {
    super(init.message)
    this.name = "PanelResponseError"
    this.status = init.status
    this.statusText = init.statusText ?? ""
    this.responseClass = init.responseClass
    this.code = init.code ?? null
  }
}

export function isPanelResponseError(error: unknown): error is PanelResponseError {
  return error instanceof PanelResponseError
}

/** Response surface the classifier needs — real `Response` and test doubles. */
export type ResponseLike = {
  ok: boolean
  status: number
  statusText?: string
  headers?: { get(name: string): string | null } | null
  json(): Promise<unknown>
}

function contentTypeOf(response: ResponseLike): string | null {
  try {
    return response.headers?.get("content-type") ?? null
  } catch {
    return null
  }
}

/**
 * A declared non-JSON content type is a format failure even when the bytes
 * would happen to parse; a missing header falls back to the parse attempt.
 */
function declaresNonJson(contentType: string | null): boolean {
  if (!contentType) return false
  return !/json/i.test(contentType)
}

type ParsedBody = { parsed: true; body: unknown } | { parsed: false }

async function tryParseJson(response: ResponseLike): Promise<ParsedBody> {
  if (declaresNonJson(contentTypeOf(response))) {
    return { parsed: false }
  }
  try {
    return { parsed: true, body: await response.json() }
  } catch {
    return { parsed: false }
  }
}

function field(body: unknown, key: string): string | null {
  if (body && typeof body === "object") {
    const value = (body as Record<string, unknown>)[key]
    return typeof value === "string" ? value : null
  }
  return null
}

/** Builds the error of a non-2xx response; the body only adds detail. */
export async function errorFromResponse(
  response: ResponseLike
): Promise<PanelResponseError> {
  const parsed = await tryParseJson(response)
  const body = parsed.parsed ? parsed.body : null
  const statusText = response.statusText ?? ""
  const fallback = parsed.parsed
    ? `${response.status} ${statusText}`.trim()
    : `${response.status} ${statusText} (odpowiedz nie jest JSON-em)`.replace(/\s+/g, " ")

  return new PanelResponseError({
    status: response.status,
    statusText,
    responseClass: classifyHttpStatus(response.status),
    message: field(body, "message") ?? fallback,
    code: field(body, "code") ?? field(body, "type"),
  })
}

/**
 * Reads the JSON body of a 2xx response. A non-JSON body is NOT returned as
 * data and NOT allowed to escape as a parser `SyntaxError` — it becomes a
 * readable `bad_format` error that keeps the status.
 */
// `any` by default on purpose: it is the type `Response.json()` had at every
// call site before 5.2, so the classified path does not change caller typing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJsonSuccess<T = any>(response: ResponseLike): Promise<T> {
  const parsed = await tryParseJson(response)
  if (!parsed.parsed) {
    const contentType = contentTypeOf(response)
    throw new PanelResponseError({
      status: response.status,
      statusText: response.statusText ?? "",
      responseClass: "bad_format",
      message: `${response.status}: odpowiedz backendu nie jest JSON-em${
        contentType ? ` (${contentType})` : ""
      }`,
    })
  }
  return parsed.body as T
}

/** A rejected `fetch` (DNS, refused connection, CORS) — no response exists. */
export function networkFailure(cause: unknown): PanelResponseError {
  return new PanelResponseError({
    status: NETWORK_FAILURE_STATUS,
    responseClass: "backend_failure",
    message: `backend nieosiagalny: ${
      cause instanceof Error ? cause.message : String(cause)
    }`,
  })
}

/** The class of any thrown value, or `null` when it is not a response error. */
export function responseClassOf(error: unknown): ResponseClass | null {
  if (isPanelResponseError(error)) return error.responseClass
  if (
    error &&
    typeof error === "object" &&
    typeof (error as { responseClass?: unknown }).responseClass === "string" &&
    (RESPONSE_CLASSES as readonly string[]).includes(
      (error as { responseClass: string }).responseClass
    )
  ) {
    return (error as { responseClass: ResponseClass }).responseClass
  }
  return null
}
