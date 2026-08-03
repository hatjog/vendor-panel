import { useMemo } from 'react';

import { Trash } from '@medusajs/icons';
import { Badge, Button, Container, Heading, IconButton, Text } from '@medusajs/ui';
import { formatDistanceToNow } from 'date-fns';
import { enUS, pl } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';

import { VendorSession } from '../../../hooks/api/sessions';

export type DisabledMeta = Record<string, { secondsRemaining: number }>;

type SessionListProps = {
  sessions: VendorSession[];
  disabledMeta?: DisabledMeta;
  onRevokeClick: (session: VendorSession) => void;
};

const localeByLanguage = {
  en: enUS,
  pl
};

const useRelativeTime = (lastActive: string) => {
  const { i18n, t } = useTranslation();

  return useMemo(() => {
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

const SessionRow = ({
  session,
  rateLimitSeconds,
  onRevokeClick
}: {
  session: VendorSession;
  rateLimitSeconds?: number;
  onRevokeClick: (session: VendorSession) => void;
}) => {
  const { t } = useTranslation();
  const lastActive = useRelativeTime(session.last_active);
  const disabled = Boolean(rateLimitSeconds && rateLimitSeconds > 0);
  const countdownId = `security-rate-limit-${session.jti}`;

  const ariaLabel = disabled
    ? t('security.session.rate_limited_aria', {
        device: session.device_class,
        seconds: rateLimitSeconds
      })
    : t('security.revoke_session_aria', { device: session.device_class });

  return (
    <li className="flex min-h-[72px] flex-col gap-3 border-t border-ui-border-base px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Text
            weight="plus"
            className="break-words"
          >
            {session.device_class}
          </Text>
          {session.current_session && (
            <Badge size="2xsmall">{t('security.session.current_badge')}</Badge>
          )}
        </div>
        <Text
          size="small"
          className="text-ui-fg-subtle"
        >
          {t('security.session.last_active', { time: lastActive })}
        </Text>
        <Text
          size="small"
          className="text-ui-fg-muted"
        >
          {session.ip_region || t('security.session.unknownRegion')}
        </Text>
        {disabled && (
          <Text
            aria-live="polite"
            id={countdownId}
            size="small"
            className="text-ui-fg-error"
          >
            {t('security.session.rate_limited_countdown', { seconds: rateLimitSeconds })}
          </Text>
        )}
      </div>
      <IconButton
        aria-describedby={disabled ? countdownId : undefined}
        aria-disabled={disabled || undefined}
        aria-label={ariaLabel}
        className="min-h-11 min-w-11 self-start sm:self-center"
        disabled={disabled}
        onClick={() => onRevokeClick(session)}
        type="button"
        variant="transparent"
      >
        <Trash />
      </IconButton>
    </li>
  );
};

export const SessionListSkeleton = () => {
  return (
    <Container className="mx-auto max-w-[800px] divide-y p-0">
      {[0, 1, 2].map(row => (
        <div
          className="flex min-h-[72px] animate-pulse items-center justify-between px-4 py-3"
          key={row}
        >
          <div className="space-y-2">
            <div className="h-4 w-48 rounded bg-ui-bg-subtle" />
            <div className="h-3 w-32 rounded bg-ui-bg-subtle" />
          </div>
          <div className="size-11 rounded-md bg-ui-bg-subtle" />
        </div>
      ))}
    </Container>
  );
};

export const SessionListError = ({ onRetry }: { onRetry: () => void }) => {
  const { t } = useTranslation();

  return (
    <Container className="mx-auto max-w-[800px] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Text className="text-ui-fg-subtle">{t('security.loadError')}</Text>
        <Button
          onClick={onRetry}
          size="small"
          type="button"
          variant="secondary"
        >
          {t('security.retry')}
        </Button>
      </div>
    </Container>
  );
};

export const SessionList = ({
  sessions,
  disabledMeta = {},
  onRevokeClick
}: SessionListProps) => {
  const { t } = useTranslation();

  return (
    <Container className="mx-auto max-w-[800px] overflow-hidden p-0">
      <div className="px-4 py-4">
        <Heading level="h2">{t('security.sessionsHeading')}</Heading>
      </div>
      {sessions.length === 0 ? (
        <div className="border-t border-ui-border-base px-4 py-6">
          <Text className="text-ui-fg-subtle">{t('security.empty')}</Text>
        </div>
      ) : (
        <ul>
          {sessions.map(session => (
            <SessionRow
              key={session.jti}
              onRevokeClick={onRevokeClick}
              rateLimitSeconds={disabledMeta[session.jti]?.secondsRemaining}
              session={session}
            />
          ))}
        </ul>
      )}
    </Container>
  );
};
