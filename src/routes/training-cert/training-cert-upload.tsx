/**
 * Story v160-7-6: Vendor training cert upload page (vendor-panel).
 *
 * Vendor self-service surface for training certificate status.
 *
 * Per Sprint 4 Wave 15 batch — FR54 vendor training certification gate.
 * v1.12.0 HG-12: browser upload is gated because the real
 * /vendor/training-cert/upload endpoint is S2S HMAC-only.
 */

import { useState } from 'react';

import { useTranslation } from 'react-i18next';

const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png'];
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

type CertStatus = 'awaiting' | 'pending_review' | 'verified' | 'rejected';

export const TrainingCertUpload = () => {
  const { t } = useTranslation();
  const [status] = useState<CertStatus>('awaiting');
  const [rejectionReason] = useState<string | null>(null);

  const statusBadge = (s: CertStatus) => {
    const map: Record<CertStatus, { color: string; label: string }> = {
      awaiting: { color: 'bg-gray-200', label: 'Awaiting upload' },
      pending_review: {
        color: 'bg-blue-100 text-blue-800',
        label: 'Pending review'
      },
      verified: { color: 'bg-green-100 text-green-800', label: 'Verified' },
      rejected: { color: 'bg-red-100 text-red-800', label: 'Rejected' }
    };
    const { color, label } = map[s];
    return <span className={`inline-block rounded px-2 py-1 text-xs ${color}`}>{label}</span>;
  };

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">
        {t('vendor.training_cert.title', 'Training Certificate')}
      </h1>
      <p className="mt-1 text-gray-600">
        {t(
          'vendor.training_cert.subtitle',
          'Upload your training certificate for admin verification.'
        )}
      </p>

      <div className="mt-4">
        <span className="font-medium">Status: </span>
        {statusBadge(status)}
        {status === 'rejected' && rejectionReason && (
          <p className="mt-1 text-sm text-red-700">Reason: {rejectionReason}</p>
        )}
      </div>

      {(status === 'awaiting' || status === 'rejected') && (
        <div className="mt-6 rounded border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
          {t(
            'vendor.training_cert.upload_unavailable',
            'Certificate upload is handled by operator-assisted onboarding. The browser upload is unavailable until vendor HMAC signing is available in this panel.'
          )}
          <p className="mt-2 text-xs text-gray-500">
            Allowed formats remain {ALLOWED_EXTENSIONS.join(', ')} · Max{' '}
            {Math.round(MAX_SIZE_BYTES / 1024 / 1024)} MB when upload is enabled.
          </p>
        </div>
      )}

      {status === 'pending_review' && (
        <div className="mt-4 rounded border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          Your certificate is awaiting admin review. You will receive an email when it is approved
          or rejected.
        </div>
      )}

      {status === 'verified' && (
        <div className="mt-4 rounded border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          Certificate verified. Pre-flag-flip gate completed.
        </div>
      )}
    </div>
  );
};

export default TrainingCertUpload;
