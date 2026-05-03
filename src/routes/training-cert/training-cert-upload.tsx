/**
 * Story v160-7-6: Vendor training cert upload page (vendor-panel).
 *
 * Vendor self-service: upload PDF/JPG/PNG (max 10 MB) → admin review queue.
 *
 * Per Sprint 4 Wave 15 batch — FR54 vendor training certification gate.
 * Real multipart upload + Mercur 2 vendor scope auth DEFERRED to production
 * wiring (shared with other vendor scope endpoints).
 */

import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"

const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"]
const MAX_SIZE_BYTES = 10 * 1024 * 1024

type CertStatus = "awaiting" | "pending_review" | "verified" | "rejected"

export const TrainingCertUpload = () => {
  const { t } = useTranslation()
  const fileRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<CertStatus>("awaiting")
  const [error, setError] = useState<string | null>(null)
  const [rejectionReason] = useState<string | null>(null)

  const validateFile = (file: File): string | null => {
    const lower = file.name.toLowerCase()
    if (!ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      return `Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`
    }
    if (file.size > MAX_SIZE_BYTES) {
      return `Max 10 MB (got ${Math.round(file.size / 1024 / 1024)} MB)`
    }
    return null
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setError("Please select a file")
      return
    }
    const validationError = validateFile(file)
    if (validationError) {
      setError(validationError)
      return
    }
    // Production wiring DEFERRED — POST /vendor/training-cert/upload (multipart).
    // Wave 15 stub: simulate success with status flip.
    setStatus("pending_review")
  }

  const statusBadge = (s: CertStatus) => {
    const map: Record<CertStatus, { color: string; label: string }> = {
      awaiting: { color: "bg-gray-200", label: "Awaiting upload" },
      pending_review: {
        color: "bg-blue-100 text-blue-800",
        label: "Pending review",
      },
      verified: { color: "bg-green-100 text-green-800", label: "Verified" },
      rejected: { color: "bg-red-100 text-red-800", label: "Rejected" },
    }
    const { color, label } = map[s]
    return (
      <span className={`inline-block rounded px-2 py-1 text-xs ${color}`}>
        {label}
      </span>
    )
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">
        {t("vendor.training_cert.title", "Training Certificate")}
      </h1>
      <p className="mt-1 text-gray-600">
        {t(
          "vendor.training_cert.subtitle",
          "Upload your training certificate for admin verification.",
        )}
      </p>

      <div className="mt-4">
        <span className="font-medium">Status: </span>
        {statusBadge(status)}
        {status === "rejected" && rejectionReason && (
          <p className="mt-1 text-sm text-red-700">
            Reason: {rejectionReason}
          </p>
        )}
      </div>

      {(status === "awaiting" || status === "rejected") && (
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="cert-file"
              className="block text-sm font-medium"
            >
              Certificate file
            </label>
            <input
              ref={fileRef}
              id="cert-file"
              type="file"
              accept={ALLOWED_EXTENSIONS.join(",")}
              className="mt-1 block w-full"
            />
            <p className="mt-1 text-xs text-gray-500">
              Allowed: {ALLOWED_EXTENSIONS.join(", ")} · Max 10 MB
            </p>
            {error && (
              <p className="mt-1 text-sm text-red-600">{error}</p>
            )}
          </div>
          <button
            type="submit"
            className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            Upload certificate
          </button>
        </form>
      )}

      {status === "pending_review" && (
        <div className="mt-4 rounded border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          Your certificate is awaiting admin review. You will receive an
          email when it is approved or rejected.
        </div>
      )}

      {status === "verified" && (
        <div className="mt-4 rounded border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          Certificate verified. Pre-flag-flip gate completed.
        </div>
      )}
    </div>
  )
}

export default TrainingCertUpload
