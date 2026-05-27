import { useEffect, useMemo, useState } from 'react';

import { Container, Heading, Text, toast } from '@medusajs/ui';
import { useTranslation } from 'react-i18next';

import {
  useRevokeVendorSession,
  useVendorSessions,
  VendorSession,
  VendorSessionApiError
} from '../../hooks/api/sessions';
import { forceVendorLogoutAndRedirect } from '../../lib/auth/vendor-logout';
import { RevokeConfirmModal } from './components/revoke-confirm-modal';
import { SessionList, SessionListError, SessionListSkeleton } from './components/session-list';

type RetryLock = {
  jti: string;
  until: number;
};

export const SecurityDetail = () => {
  const { t } = useTranslation();
  const [selectedSession, setSelectedSession] = useState<VendorSession | null>(null);
  const [retryLock, setRetryLock] = useState<RetryLock | null>(null);
  const sessionsQuery = useVendorSessions();
  const revokeSession = useRevokeVendorSession();

  useEffect(() => {
    if (!retryLock) {
      return;
    }

    const timeout = window.setTimeout(() => setRetryLock(null), retryLock.until - Date.now());

    return () => window.clearTimeout(timeout);
  }, [retryLock]);

  const disabledJtis = useMemo(() => {
    if (!retryLock || retryLock.until <= Date.now()) {
      return new Set<string>();
    }

    return new Set([retryLock.jti]);
  }, [retryLock]);

  const handleError = (error: unknown, session: VendorSession) => {
    if (error instanceof VendorSessionApiError) {
      if (error.kind === 'rate_limited') {
        const seconds = error.retryAfterSeconds || 20;

        setRetryLock({
          jti: session.jti,
          until: Date.now() + seconds * 1000
        });
        toast.error(t('security.toast.error_rate_limited'));
        return;
      }

      if (error.kind === 'server') {
        toast.error(t('security.toast.error_server'));
        return;
      }
    }

    toast.error(t('security.toast.error_generic'));
  };

  const handleConfirm = async () => {
    if (!selectedSession) {
      return;
    }

    try {
      await revokeSession.mutateAsync({
        jti: selectedSession.jti,
        current_session: selectedSession.current_session
      });

      if (selectedSession.current_session) {
        forceVendorLogoutAndRedirect();
        return;
      }

      toast.success(t('security.toast.success', { device: selectedSession.device_class }));
      setSelectedSession(null);
    } catch (error) {
      handleError(error, selectedSession);
    }
  };

  return (
    <div className="flex w-full flex-col gap-y-6 px-6 py-6">
      <Container className="mx-auto max-w-[800px] p-6">
        <div className="space-y-2">
          <Heading>{t('security.domain')}</Heading>
          <Text className="text-ui-fg-subtle">{t('security.intro')}</Text>
        </div>
      </Container>

      {sessionsQuery.isLoading ? (
        <SessionListSkeleton />
      ) : sessionsQuery.isError ? (
        <SessionListError onRetry={() => sessionsQuery.refetch()} />
      ) : (
        <SessionList
          disabledJtis={disabledJtis}
          onRevokeClick={setSelectedSession}
          sessions={sessionsQuery.data?.sessions || []}
        />
      )}

      <RevokeConfirmModal
        loading={revokeSession.isPending}
        onConfirm={handleConfirm}
        onOpenChange={open => {
          if (!open && !revokeSession.isPending) {
            setSelectedSession(null);
          }
        }}
        open={!!selectedSession}
        session={selectedSession}
      />
    </div>
  );
};
