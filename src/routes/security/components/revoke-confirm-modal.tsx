import { useMemo } from 'react';

import { clx, Prompt, Text } from '@medusajs/ui';
import { formatDistanceToNow } from 'date-fns';
import { enUS, pl } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';

import { VendorSession } from '../../../hooks/api/sessions';

type RevokeConfirmModalProps = {
  session: VendorSession | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
  loading: boolean;
};

const localeByLanguage = {
  en: enUS,
  pl
};

const useRelativeLastActive = (lastActive: string | undefined) => {
  const { i18n, t } = useTranslation();

  return useMemo(() => {
    if (!lastActive) {
      return t('security.session.unknownLastActive');
    }

    const parsed = new Date(lastActive);

    if (Number.isNaN(parsed.getTime())) {
      return t('security.session.unknownLastActive');
    }

    const language = i18n.language.split('-')[0] as keyof typeof localeByLanguage;

    return formatDistanceToNow(parsed, {
      addSuffix: true,
      locale: localeByLanguage[language] || enUS
    });
  }, [i18n.language, lastActive, t]);
};

export const RevokeConfirmModal = ({
  session,
  open,
  onOpenChange,
  onConfirm,
  loading
}: RevokeConfirmModalProps) => {
  const { t } = useTranslation();
  const lastActive = useRelativeLastActive(session?.last_active);

  if (!session) {
    return null;
  }

  const currentSession = session.current_session;
  const title = currentSession
    ? t('security.modal.current.title')
    : t('security.modal.other.title');

  const handleOpenChange = (next: boolean) => {
    if (loading && !next) {
      return;
    }
    onOpenChange(next);
  };

  return (
    <Prompt
      onOpenChange={handleOpenChange}
      open={open}
      variant={currentSession ? 'danger' : 'confirmation'}
    >
      <Prompt.Content
        aria-describedby="security-revoke-modal-body"
        aria-labelledby="security-revoke-modal-title"
        aria-modal="true"
        onEscapeKeyDown={event => {
          if (loading) {
            event.preventDefault();
          }
        }}
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
                  <Text>{t('security.modal.current.tier2_fallback')}</Text>
                  <Text>{t('security.modal.current.tier3')}</Text>
                </>
              ) : (
                <Text>
                  {t('security.modal.other.body', {
                    device: session.device_class,
                    lastActive
                  })}
                </Text>
              )}
            </div>
          </Prompt.Description>
        </Prompt.Header>
        <Prompt.Footer>
          <Prompt.Cancel
            autoFocus
            disabled={loading}
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
