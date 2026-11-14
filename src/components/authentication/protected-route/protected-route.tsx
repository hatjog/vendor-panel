import { Spinner } from "@medusajs/icons"
import { Button } from "@medusajs/ui"
import { useTranslation } from "react-i18next"
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom"
import { useLogout } from "../../../hooks/api/auth"
import { useMe } from "../../../hooks/api/users"
import {
  isPanelResponseError,
  responseClassOf,
} from "../../../lib/client/response-class"
import { clearStoredSellerId } from "../../../lib/client/seller-context"
import { ResponseErrorState } from "../../common/response-error-state"
import { SearchProvider } from "../../../providers/search-provider"
import { SidebarProvider } from "../../../providers/sidebar-provider"
import { TalkjsProvider } from "../../../providers/talkjs-provider"

/** Login `reason` for a refused seller context (localized on the login screen). */
export const SELLER_CONTEXT_REASON = "seller_context"

/**
 * v1.16.0 Story 5.2 (AC2, R-12): `ensureSellerMiddleware` (@mercurjs/core)
 * answers `GET /vendor/sellers/me` with `400 not_allowed` when the seller
 * context is missing (no `x-seller-id`) or stale (stored seller id of a salon
 * the member no longer belongs to, e.g. after a pre-prod DB reload) while the
 * JWT is still valid. That is a refusal of the ACTOR'S CONTEXT, not an
 * invalid request: signing in again re-resolves the context
 * (`resolveSellerContext`), so it is handled like `forbidden`.
 */
export function isSellerContextRefusal(error: unknown): boolean {
  return (
    isPanelResponseError(error) &&
    error.status === 400 &&
    (error.code ?? "").toLowerCase() === "not_allowed"
  )
}

const ResponseErrorExit = ({ refetch }: { refetch?: () => unknown }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { mutate: logout, isPending } = useLogout()

  const relogin = () => {
    // The seller context is cleared before the logout call, so even a failed
    // logout request cannot leave a stale salon id behind (NFR-4).
    clearStoredSellerId()
    logout(undefined, {
      onSettled: () => navigate("/login", { replace: true }),
    })
  }

  return (
    <div className="flex items-center gap-x-2">
      {refetch ? (
        <Button
          size="small"
          variant="secondary"
          data-testid="protected-route-retry"
          onClick={() => void refetch()}
        >
          {t("responseError.retryAction")}
        </Button>
      ) : null}
      <Button
        size="small"
        variant="primary"
        data-testid="protected-route-relogin"
        isLoading={isPending}
        onClick={relogin}
      >
        {t("responseError.reloginAction")}
      </Button>
    </div>
  )
}

export const ProtectedRoute = () => {
  const { seller, isPending, error, refetch } = useMe()

  const location = useLocation()
  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="text-ui-fg-interactive animate-spin" />
      </div>
    )
  }

  // R-12: a refused seller context goes back to /login with the stored
  // seller id cleared and a distinguishable, localized reason.
  if (!seller && isSellerContextRefusal(error)) {
    clearStoredSellerId()
    return (
      <Navigate
        to={`/login?reason=${SELLER_CONTEXT_REASON}`}
        state={{ from: location }}
        replace
      />
    )
  }

  // v1.16.0 Story 5.2 (AC2): only a refusal of the actor (401/403 →
  // `forbidden`, or the seller-context 400 above) or an unclassified failure
  // sends the user to /login. Every other response class (wrong
  // `__BACKEND_URL__` answering HTML, unreachable backend, missing route,
  // 5xx, other 4xx) is a distinguishable, localized state here — never a raw
  // client message passed to the login screen — and always offers a way out
  // (retry / sign out and sign in again).
  const responseClass = responseClassOf(error)
  if (!seller && responseClass && responseClass !== "forbidden") {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-y-2"
        data-testid="protected-route-response-error"
      >
        <ResponseErrorState error={error} />
        <ResponseErrorExit refetch={refetch} />
      </div>
    )
  }

  if (!seller) {
    return (
      <Navigate
        to={`/login${error?.message ? `?reason=${encodeURIComponent(error.message)}` : ""}`}
        state={{ from: location }}
        replace
      />
    )
  }

  return (
    <TalkjsProvider>
      <SidebarProvider>
        <SearchProvider>
          <Outlet />
        </SearchProvider>
      </SidebarProvider>
    </TalkjsProvider>
  )
}
