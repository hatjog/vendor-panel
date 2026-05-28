import { useCallback, useEffect, useMemo, useState } from 'react';

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

export const SecurityDetail = () => {
  const { t } = useTranslation();
  const [selectedSession, setSelectedSession] = useState<VendorSession | null>(null);
  const [retryLocks, setRetryLocks] = useState<Record<string, number>>({});
  const [now, setNow] = useState<number>(() => Date.now());
  const sessionsQuery = useVendorSessions();
  const revokeSession = useRevokeVendorSession();

  const hasActiveLocks = Object.values(retryLocks).some(until => until > now);

  useEffect(() => {
    if (!hasActiveLocks) {
      return;
    }

    const tick = window.setInterval(() => setNow(Date.now()), 1000);

    return () => window.clearInterval(tick);
  }, [hasActiveLocks]);

  useEffect(() => {
    setRetryLocks(prev => {
      const next: Record<string, number> = {};
      let mutated = false;

      for (const [jti, until] of Object.entries(prev)) {
        if (until > now) {
          next[jti] = until;
        } else {
          mutated = true;
        }
      }

      return mutated ? next : prev;
    });
  }, [now]);

  const disabledMeta = useMemo(() => {
    const entries: Record<string, { secondsRemaining: number }> = {};

    for (const [jti, until] of Object.entries(retryLocks)) {
      const remaining = Math.max(0, Math.ceil((until - now) / 1000));

      if (remaining > 0) {
        entries[jti] = { secondsRemaining: remaining };
      }
    }

    return entries;
  }, [retryLocks, now]);

  const handleError = useCallback(
    (error: unknown, session: VendorSession) => {
      if (error instanceof VendorSessionApiError) {
        if (error.kind === 'rate_limited') {
          const seconds = error.retryAfterSeconds || 20;

          setRetryLocks(prev => ({
            ...prev,
            [session.jti]: Date.now() + seconds * 1000
          }));
          toast.error(t('security.toast.error_rate_limited', { seconds }));
          return;
        }

        if (error.kind === 'server') {
          toast.error(t('security.toast.error_server'));
          return;
        }
      }

      toast.error(t('security.toast.error_generic'));
    },
    [t]
  );

  const handleConfirm = async () => {
    if (!selectedSession) {
      return;
    }

    try {
      await revokeSession.mutateAsync({
        jti: selectedSession.jti,
        current_session: selectedSession.current_session,
        onRetryServerError: () => toast.info(t('security.toast.info_retry_server'))
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
          disabledMeta={disabledMeta}
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
