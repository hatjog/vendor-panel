import { Spinner } from "@medusajs/icons"
import { Navigate, Outlet, useLocation } from "react-router-dom"
import { useMe } from "../../../hooks/api/users"
import { responseClassOf } from "../../../lib/client/response-class"
import { ResponseErrorState } from "../../common/response-error-state"
import { SearchProvider } from "../../../providers/search-provider"
import { SidebarProvider } from "../../../providers/sidebar-provider"
import { TalkjsProvider } from "../../../providers/talkjs-provider"

export const ProtectedRoute = () => {
  const { seller, isPending, error } = useMe()

  const location = useLocation()
  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="text-ui-fg-interactive animate-spin" />
      </div>
    )
  }

  // v1.16.0 Story 5.2 (AC2): only a refusal of the actor (401/403 →
  // `forbidden`) or an unclassified failure sends the user to /login. Every
  // other response class (wrong `__BACKEND_URL__` answering HTML, unreachable
  // backend, missing route, 5xx) is a distinguishable, localized state here —
  // never a raw client message passed to the login screen.
  const responseClass = responseClassOf(error)
  if (!seller && responseClass && responseClass !== "forbidden") {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        data-testid="protected-route-response-error"
      >
        <ResponseErrorState error={error} />
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
