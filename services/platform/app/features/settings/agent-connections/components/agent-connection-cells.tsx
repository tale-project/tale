'use client';

import { Badge, badgeVariants } from '@tale/ui/badge';
import { cn } from '@tale/ui/cn';
import { TableIconCell } from '@tale/ui/data-table/table-icon-cell';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { Bot } from 'lucide-react';
import type { ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';
import type { AccessLevel, ExtraScope } from '@/lib/shared/agent-access';

import { summarizeAccess } from '../lib/access-summary';
import type { AgentConnection } from '../types';

/** Why a connection ended, in the words of the list. An ending this version
 * does not know yet reads as no reason at all. */
function useEndReason() {
  const { t } = useT('agentConnections');
  const words: Partial<Record<string, string>> = {
    user: t('list.reasons.user'),
    admin: t('list.reasons.admin'),
    membership_ended: t('list.reasons.membership_ended'),
    account_security: t('list.reasons.account_security'),
    refresh_reuse: t('list.reasons.refresh_reuse'),
    client_removed: t('list.reasons.client_removed'),
  };
  return (reason: AgentConnection['revokeReason']): string | null =>
    reason === null ? null : (words[reason] ?? null);
}

interface AgentCellProps {
  connection: AgentConnection;
  /** The signed-in person, so their own agents read as theirs. */
  viewerUserId?: string | undefined;
  /**
   * What the table has no column for at this width, carried under the
   * agent's name instead: on a phone a person still has to tell three
   * "Claude Code" rows apart — whose they are, what they may do, whether
   * they are in use — before cutting one off.
   */
  carries?: { person?: boolean; access?: boolean };
}

/**
 * The agent a row is about: its name and, under it, where Tale knows it
 * from — the domain it proved, or a plain "Unverified" for an app that
 * registered itself and chose its own name. An ended connection says when
 * and why instead.
 */
export function AgentCell({
  connection,
  viewerUserId,
  carries,
}: AgentCellProps) {
  const { t } = useT('agentConnections');
  const { formatDate } = useFormatDate();
  const endReason = useEndReason();

  let caption: ReactNode;
  if (connection.revokedAt !== null) {
    const reason = endReason(connection.revokeReason);
    const date = formatDate(new Date(connection.revokedAt), 'short');
    // When and why is the point of the line: it wraps instead of losing its
    // reason to an ellipsis.
    caption = (
      <span className="block whitespace-normal">
        {reason === null
          ? t('list.disconnectedOnly', { date })
          : t('list.disconnectedOn', { date, reason })}
      </span>
    );
  } else if (
    connection.provenance === 'metadata_document' &&
    connection.clientHost !== null
  ) {
    caption = connection.clientHost;
  } else {
    caption = <Badge variant="orange">{t('list.unverified')}</Badge>;
  }

  const cell = (
    <TableIconCell
      icon={<Bot />}
      label={connection.clientName}
      title={connection.clientName}
      caption={caption}
    />
  );
  if (!carries?.person && !carries?.access) return cell;

  const lastUsed =
    connection.lastUsedAt === null
      ? t('list.neverUsed')
      : t('list.lastUsedAt', {
          when: formatDate(new Date(connection.lastUsedAt), 'relative'),
        });

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {cell}
      {/* Under the name, not the mark: the mark's 20px slot and the 8px gap
          are the cell's own. */}
      <div className="flex min-w-0 flex-col gap-1 pl-7">
        {carries.person ? (
          <AgentPersonCell
            connection={connection}
            viewerUserId={viewerUserId}
          />
        ) : null}
        {carries.access ? (
          <>
            <AgentAccessCell scopes={connection.scopes} />
            <Text as="span" variant="caption">
              {lastUsed}
            </Text>
          </>
        ) : null}
      </div>
    </div>
  );
}

interface AgentPersonCellProps {
  connection: Pick<AgentConnection, 'userId' | 'personName' | 'personEmail'>;
  /** The signed-in person, so their own agents read as theirs. */
  viewerUserId: string | undefined;
}

/** Whose agent it is: their name and, under it, their address. */
export function AgentPersonCell({
  connection,
  viewerUserId,
}: AgentPersonCellProps) {
  const { t } = useT('agentConnections');

  const name =
    connection.userId === viewerUserId
      ? t('list.you')
      : connection.personName ||
        connection.personEmail ||
        t('list.unknownPerson');
  const address =
    connection.personName && connection.personEmail
      ? connection.personEmail
      : null;

  return (
    <div className="flex min-w-0 flex-col">
      <Text as="span" truncate className="text-sm" title={name}>
        {name}
      </Text>
      {address !== null && (
        <Text
          as="span"
          variant="muted"
          truncate
          className="text-xs"
          title={address}
        >
          {address}
        </Text>
      )}
    </div>
  );
}

const LEVEL_VARIANT = {
  read: 'slate',
  edit: 'blue',
  deploy: 'orange',
} as const satisfies Record<AccessLevel, 'slate' | 'blue' | 'orange'>;

const EXTRA_VARIANT = {
  'tale:settings.read': 'slate',
  'tale:settings.write': 'orange',
  'tale:subscriptions.connect': 'orange',
} as const satisfies Record<ExtraScope, 'slate' | 'orange'>;

/**
 * A badge for one thing the agent may do. It looks like the design system's
 * badge, but wraps its words onto a second line where `Badge` cuts them
 * short: the words are the point of the column, and the longest of them — in
 * German and French — do not fit the width it has.
 */
function AccessBadge({
  variant,
  children,
}: {
  variant: 'slate' | 'blue' | 'orange';
  children: string;
}) {
  return (
    <span className={cn(badgeVariants({ variant }), 'whitespace-normal')}>
      {children}
    </span>
  );
}

interface AgentAccessCellProps {
  scopes: readonly string[];
}

/**
 * What the agent may do, in the words the person chose it with on the
 * consent page: the level it holds and the extras beside it, a warmer tint
 * for what acts live or changes something.
 */
export function AgentAccessCell({ scopes }: AgentAccessCellProps) {
  const { t } = useT('agentConnections');
  const { level, extras } = summarizeAccess(scopes);

  /** Each key is named in full, so the catalog's checks can find it. */
  const levelWords = (held: AccessLevel) =>
    held === 'read'
      ? t('consent.access.read.label')
      : held === 'edit'
        ? t('consent.access.edit.label')
        : t('consent.access.deploy.label');
  const extraWords = (extra: ExtraScope) =>
    extra === 'tale:settings.read'
      ? t('consent.extras.settingsRead')
      : extra === 'tale:settings.write'
        ? t('consent.extras.settingsWrite')
        : t('consent.extras.subscriptions');

  return (
    <div className="flex flex-wrap gap-1">
      {level === null ? null : (
        <AccessBadge variant={LEVEL_VARIANT[level]}>
          {levelWords(level)}
        </AccessBadge>
      )}
      {extras.map((extra) => (
        <AccessBadge key={extra} variant={EXTRA_VARIANT[extra]}>
          {extraWords(extra)}
        </AccessBadge>
      ))}
    </div>
  );
}
