/**
 * Story v160-7-6: Vendor training cert upload page (vendor-panel).
 *
 * Vendor self-service surface for training certificate status.
 *
 * Per Sprint 4 Wave 15 batch — FR54 vendor training certification gate.
 * v1.12.0 HG-12: browser upload is gated because the real
 * /vendor/training-cert/upload endpoint is S2S HMAC-only.
 * Dead state branches (pending_review / verified / rejected) removed —
 * the gate is permanent until HMAC signing is available in this panel.
 */

import { useTranslation } from 'react-i18next';

const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png'];
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

export const TrainingCertUpload = () => {
  const { t } = useTranslation();

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

      <div className="mt-6 rounded border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
        {t(
          'vendor.training_cert.upload_unavailable',
          'Certificate upload is handled by operator-assisted onboarding. The browser upload is unavailable until vendor HMAC signing is available in this panel. S2S HMAC-only'
        )}
        <p className="mt-2 text-xs text-gray-500">
          Allowed formats remain {ALLOWED_EXTENSIONS.join(', ')} · Max{' '}
          {Math.round(MAX_SIZE_BYTES / 1024 / 1024)} MB when upload is enabled.
        </p>
      </div>
    </div>
  );
};

export default TrainingCertUpload;
