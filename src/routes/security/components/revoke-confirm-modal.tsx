import { useEffect, useRef } from 'react';

import { clx, Prompt, Text } from '@medusajs/ui';
import { useTranslation } from 'react-i18next';

import { VendorSession } from '../../../hooks/api/sessions';

type RevokeConfirmModalProps = {
  session: VendorSession | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
  loading: boolean;
};

const useDirtyFormsDetector = () => {
  return {
    dirty: false,
    labels: [] as string[]
  };
};

export const RevokeConfirmModal = ({
  session,
  open,
  onOpenChange,
  onConfirm,
  loading
}: RevokeConfirmModalProps) => {
  const { t } = useTranslation();
  const dirtyForms = useDirtyFormsDetector();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      window.setTimeout(() => cancelRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onOpenChange, open]);

  if (!session) {
    return null;
  }

  const currentSession = session.current_session;
  const title = currentSession
    ? t('security.modal.current.title')
    : t('security.modal.other.title');
  const tier2Label = dirtyForms.dirty
    ? dirtyForms.labels[0] || t('security.modal.current.tier2_fallback_label')
    : t('security.modal.current.tier2_fallback_label');

  return (
    <Prompt
      open={open}
      variant={currentSession ? 'danger' : 'confirmation'}
    >
      <Prompt.Content
        aria-describedby="security-revoke-modal-body"
        aria-labelledby="security-revoke-modal-title"
        aria-modal="true"
      >
        <Prompt.Header>
          <Prompt.Title id="security-revoke-modal-title">{title}</Prompt.Title>
          <Prompt.Description asChild>
            <div
              className="space-y-3"
              id="security-revoke-modal-body"
            >
              {currentSession ? (
                <>
                  <Text weight="plus">{t('security.modal.current.tier1')}</Text>
                  <Text>
                    {dirtyForms.dirty
                      ? t('security.modal.current.tier2', {
                          label: tier2Label
                        })
                      : t('security.modal.current.tier2_fallback')}
                  </Text>
                  <Text>{t('security.modal.current.tier3')}</Text>
                </>
              ) : (
                <Text>
                  {t('security.modal.other.body', {
                    device: session.device_class,
                    lastActive: session.last_active
                  })}
                </Text>
              )}
            </div>
          </Prompt.Description>
        </Prompt.Header>
        <Prompt.Footer>
          <Prompt.Cancel
            disabled={loading}
            onClick={() => onOpenChange(false)}
            ref={cancelRef}
            type="button"
          >
            {t('security.modal.cancel')}
          </Prompt.Cancel>
          <Prompt.Action
            className={clx({
              'pointer-events-none opacity-70': loading
            })}
            disabled={loading}
            onClick={onConfirm}
            type="button"
          >
            {loading
              ? t('security.modal.loading')
              : currentSession
                ? t('security.modal.confirm.current')
                : t('security.modal.confirm.other')}
          </Prompt.Action>
        </Prompt.Footer>
      </Prompt.Content>
    </Prompt>
  );
};
