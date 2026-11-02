import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { IconButton } from '@tale/ui/icon-button';
import { PropertyList, PropertyRow } from '@tale/ui/property-list';
import { Text } from '@tale/ui/text';
import { useCopy } from '@tale/ui/use-copy';
import { Check, Copy, MapPin, RotateCw, TriangleAlert } from 'lucide-react';

import { useCheckIp } from '@/app/features/sessions/hooks/use-check-ip';
import { outOfSync } from '@/app/features/sessions/lib/status';
import {
  WARNING_ICON_CLASS,
  WARNING_TEXT_CLASS,
} from '@/app/features/sessions/lib/warning-tone';
import { pendingIcon } from '@/app/lib/pending-icon';
import type { Session } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { exitOf } from '../lib/exit-of';

interface SessionDetailsProps {
  session: Session;
  /**
   * What can be done about the exit IP of a session that runs: look at it
   * again, and restart the session to fit the place to a new one. Offered
   * when this is given; `onRestart` asks the question (the details do not own
   * its dialog, because the popover that holds them closes before it opens).
   */
  actions?: { onRestart: () => void };
}

/**
 * What a session is, as the properties of a record: its system, screen,
 * language, time zone and location, the IP its proxy exits through, and
 * whether the place still fits that IP. ONE list for every state of the
 * session: the details a running session opens from its header, and the body
 * of the page of one that is stopped, starting or failed.
 */
export function SessionDetails({ session, actions }: SessionDetailsProps) {
  const { t } = useT('viewer');
  const { t: tSessions } = useT('sessions');
  const place = session.location;
  const exit = exitOf(session);

  // The names the Add session dialog has for them; a system the app does not
  // know is shown as it is.
  const systemName = (os: string): string => {
    switch (os) {
      case 'windows':
        return tSessions('add.os.windows');
      case 'macos':
        return tSessions('add.os.macos');
      case 'linux':
        return tSessions('add.os.linux');
      default:
        return os;
    }
  };

  const rows: { label: string; value: string | undefined | null }[] = [
    { label: t('card.system'), value: systemName(session.os) },
    {
      label: t('card.screen'),
      value: session.fingerprint.screen?.replace('x', '×'),
    },
    { label: t('card.language'), value: session.fingerprint.locale },
    { label: t('card.timeZone'), value: session.fingerprint.timezone },
    {
      label: t('card.location'),
      value:
        place === null
          ? null
          : t('card.coordinates', {
              latitude: place.latitude,
              longitude: place.longitude,
            }),
    },
  ];
  const exitValue =
    exit?.line ??
    (session.proxy === null ? t('card.noProxyYet') : t('card.notChecked'));

  return (
    <div className="flex flex-col gap-4">
      <PropertyList>
        {rows
          .filter((row) => row.value)
          .map((row) => (
            <PropertyRow key={row.label} label={row.label}>
              <Text as="span" className="text-sm break-words tabular-nums">
                {row.value}
              </Text>
            </PropertyRow>
          ))}
        <PropertyRow
          label={t('card.ipAddress')}
          trailing={exit === null ? undefined : <CopyIpButton ip={exit.ip} />}
        >
          <Text as="span" className="text-sm break-words tabular-nums">
            {exitValue}
          </Text>
        </PropertyRow>
      </PropertyList>
      {place !== null && (
        <Text variant="caption">{t('details.source', { ip: place.ip })}</Text>
      )}
      <SyncState session={session} />
      {actions !== undefined && (
        <ExitIpActions session={session} onRestart={actions.onRestart} />
      )}
    </div>
  );
}

/**
 * The copy button of the exit IP: the glyph turns into a check for a moment,
 * and a live region says it. The small ghost button of a property's own
 * control, as the platform's task details have it (`tasks/components/task-modal.tsx`).
 */
function CopyIpButton({ ip }: { ip: string }) {
  const { t } = useT('viewer');
  const { t: tCommon } = useT('common');
  const { copied, copy } = useCopy();
  return (
    <>
      <IconButton
        icon={copied ? Check : Copy}
        size="sm"
        variant="ghost"
        className="text-muted-foreground mt-0.5 size-6"
        aria-label={t('details.copyIp')}
        onClick={() => void copy(ip)}
      />
      {/* A live region of its own, and no `status` role: the card that holds
          these details has the one status of the page. */}
      <span aria-live="polite" className="sr-only">
        {copied ? tCommon('actions.copied') : ''}
      </span>
    </>
  );
}

/** Whether the time zone and location of a running session still fit its exit IP, in words and a glyph. */
function SyncState({ session }: { session: Session }) {
  const { t } = useT('viewer');
  if (session.status !== 'running') return null;
  if (outOfSync(session)) {
    return (
      <Text
        variant="caption"
        className={cn(
          'flex items-start gap-1.5 font-medium',
          WARNING_TEXT_CLASS,
        )}
      >
        <TriangleAlert
          aria-hidden
          className={cn('mt-px size-3.5 shrink-0', WARNING_ICON_CLASS)}
        />
        {t('chip.outOfSync')}
      </Text>
    );
  }
  if (session.location?.inSync === true) {
    return (
      <Text variant="caption" className="flex items-start gap-1.5">
        <Check aria-hidden className="mt-px size-3.5 shrink-0" />
        {t('chip.inSync')}
      </Text>
    );
  }
  return null;
}

/** Look at the proxy again; and, once the exit IP changed, restart to fit the place to it. */
function ExitIpActions({
  session,
  onRestart,
}: {
  session: Session;
  onRestart: () => void;
}) {
  const { t } = useT('viewer');
  const { t: tSessions } = useT('sessions');
  const { check, isPending } = useCheckIp();
  const canCheck = session.status === 'running' && session.proxy !== null;
  const canRestart = outOfSync(session);
  if (!canCheck && !canRestart) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {canCheck && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          {...pendingIcon(isPending, MapPin)}
          // Busy, not gone: `isLoading` would disable the button natively and
          // drop the keyboard, which the person who pressed it still holds.
          aria-busy={isPending || undefined}
          aria-disabled={isPending || undefined}
          onClick={isPending ? undefined : () => check(session.id)}
        >
          {tSessions('menu.checkIp')}
        </Button>
      )}
      {canRestart && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          icon={RotateCw}
          onClick={onRestart}
        >
          {t('place.restart')}
        </Button>
      )}
    </div>
  );
}
