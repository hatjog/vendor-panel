import { ExclamationCircle } from "@medusajs/icons"
import { Text, clx } from "@medusajs/ui"
import { useTranslation } from "react-i18next"

import {
  responseClassOf,
  type ResponseClass,
} from "../../../lib/client/response-class"

/**
 * v1.16.0 Story 5.2 (AC2, NFR-4): a distinguishable error in the place where
 * a list or detail would otherwise fall back to a FALSE empty-state.
 *
 * The message is chosen by the response CLASS carried by the client error
 * (`lib/client/response-class.ts`), never by the screen: a missing route,
 * a refusal, a backend failure and a wrong format each have their own text.
 * The HTTP status is shown next to it so the operator can report it.
 */
export const RESPONSE_ERROR_I18N_KEYS = {
  route_missing: {
    title: "responseError.routeMissingTitle",
    message: "responseError.routeMissingMessage",
  },
  forbidden: {
    title: "responseError.forbiddenTitle",
    message: "responseError.forbiddenMessage",
  },
  backend_failure: {
    title: "responseError.backendFailureTitle",
    message: "responseError.backendFailureMessage",
  },
  bad_format: {
    title: "responseError.badFormatTitle",
    message: "responseError.badFormatMessage",
  },
  request_rejected: {
    title: "responseError.requestRejectedTitle",
    message: "responseError.requestRejectedMessage",
  },
} as const satisfies Record<ResponseClass, { title: string; message: string }>

type ResponseErrorStateProps = {
  error: unknown
  className?: string
}

/** `true` when the value carries a response class this component can name. */
export const hasResponseClass = (error: unknown): boolean =>
  responseClassOf(error) !== null

export const ResponseErrorState = ({
  error,
  className,
}: ResponseErrorStateProps) => {
  const { t } = useTranslation()
  const responseClass = responseClassOf(error)

  if (!responseClass) {
    return null
  }

  const keys = RESPONSE_ERROR_I18N_KEYS[responseClass]
  const status =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status: unknown }).status)
      : null

  return (
    <div
      role="alert"
      data-testid="response-error-state"
      data-response-class={responseClass}
      data-response-status={status ?? undefined}
      className={clx(
        "flex min-h-[200px] w-full items-center justify-center py-8",
        className
      )}
    >
      <div className="text-ui-fg-subtle flex flex-col items-center gap-y-2">
        <ExclamationCircle />
        <Text size="small" leading="compact" weight="plus">
          {t(keys.title)}
        </Text>
        <Text size="small" className="text-ui-fg-muted text-balance text-center">
          {t(keys.message)}
        </Text>
        {status !== null && Number.isFinite(status) ? (
          <Text size="xsmall" className="text-ui-fg-muted">
            {t("responseError.statusLabel", { status })}
          </Text>
        ) : null}
      </div>
    </div>
  )
}
