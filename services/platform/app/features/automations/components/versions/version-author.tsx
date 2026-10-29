'use client';

import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { cn } from '@tale/ui/cn';
import { SKELETON_PULSE } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { useCallback } from 'react';

import { useMembers } from '@/app/features/settings/organization/hooks/queries';
import { useT } from '@/lib/i18n/client';
import type { AutomationWriteVia } from '@/lib/shared/schemas/automation-versions';

import { type ActorLabel, useActorLabel } from '../../hooks/use-actor-label';

/** Who changed an automation and how: a version's saver, or whoever put a
 * version live, as the history records them. */
export interface AuthorFacts {
  /** A bare user id, `user:<id>`, `api-key:<id>` or `system:<what>`. */
  actor: string;
  /** The door: the app, an upload, MCP, the REST API, managed configuration
   * or the platform; null when none is recorded. */
  via: AutomationWriteVia | null;
  /** The door was read from who acted, not recorded then: no client is
   * named. */
  viaInferred?: boolean;
  /** The name the acting agent's client gave itself. */
  clientName: string | null;
}

/** An author in words: `name` is null while the member directory loads,
 * and "Someone" once its read has failed; `caption` says through which door
 * and client, when known. */
export interface AuthorText {
  actor: ActorLabel;
  name: string | null;
  caption: string | null;
  /** The author as the subject of a sentence (`{who, select, you {…}
   * other {{author} …}}`). */
  subject: { who: 'you' | 'other'; author: string };
}

const VIA_KEY: Readonly<Record<AutomationWriteVia, string>> = {
  app: 'versions.via.app',
  upload: 'versions.via.upload',
  mcp: 'versions.via.mcp',
  rest: 'versions.via.rest',
  managed: 'versions.via.managed',
  system: 'versions.via.system',
};

/**
 * The words for an author: the member's name, "You", "Tale", a former
 * member, "Not recorded", or "Someone" when the member directory could not
 * be read; and how they acted — "with Claude Code through MCP", "in the
 * app". The platform's own writes need no caption: "Tale" says it.
 */
export function useAuthorText(
  organizationId: string,
): (facts: AuthorFacts) => AuthorText {
  const { t } = useT('automations');
  const actorLabel = useActorLabel(organizationId);
  return useCallback(
    (facts: AuthorFacts): AuthorText => {
      const actor = actorLabel(facts.actor);
      const name =
        actor.kind === 'you'
          ? t('versions.author.you')
          : actor.kind === 'member'
            ? actor.name
            : actor.kind === 'former'
              ? t('versions.author.former')
              : actor.kind === 'system'
                ? t('versions.author.tale')
                : actor.kind === 'unknown'
                  ? t('versions.author.unknown')
                  : actor.kind === 'unavailable'
                    ? t('versions.author.someone')
                    : null;
      const caption =
        actor.kind === 'system' || facts.via === null || facts.via === 'system'
          ? null
          : t('versions.author.caption', {
              client:
                facts.viaInferred === true || facts.clientName === null
                  ? 'none'
                  : facts.clientName,
              via: t(VIA_KEY[facts.via]),
            });
      const subject =
        actor.kind === 'you'
          ? { who: 'you' as const, author: '' }
          : {
              who: 'other' as const,
              author:
                name === null || actor.kind === 'unknown'
                  ? t('versions.author.someone')
                  : name,
            };
      return { actor, name, caption, subject };
    },
    [actorLabel, t],
  );
}

/**
 * Who saved a version or put one live, and how: the name over the door and
 * client (`stacked`, a table cell) or after it on one line (`inline`, a
 * byline). While the member directory loads the name is a placeholder,
 * never a guess; a directory that could not be read leaves "Someone", and
 * the page says why with {@link AuthorNamesLoadError}.
 */
export function VersionAuthor({
  organizationId,
  facts,
  layout = 'stacked',
  className,
}: {
  organizationId: string;
  facts: AuthorFacts;
  layout?: 'stacked' | 'inline';
  className?: string;
}) {
  const author = useAuthorText(organizationId)(facts);
  const name =
    author.name === null ? (
      <span
        aria-hidden="true"
        data-slot="author-pending"
        className={cn(SKELETON_PULSE, 'inline-block h-3.5 w-24 rounded')}
      />
    ) : (
      author.name
    );
  if (layout === 'inline') {
    return (
      <span className={cn('min-w-0', className)}>
        {name}
        {author.caption !== null && (
          <>
            <span aria-hidden="true" className="text-muted-foreground">
              {' · '}
            </span>
            <span className="text-muted-foreground">{author.caption}</span>
          </>
        )}
      </span>
    );
  }
  return (
    <span className={cn('flex min-w-0 flex-col', className)}>
      <Text as="span" truncate title={author.name ?? undefined}>
        {name}
      </Text>
      {author.caption !== null && (
        <Text
          as="span"
          variant="caption"
          truncate
          title={author.caption}
          className="block"
        >
          {author.caption}
        </Text>
      )}
    </span>
  );
}

/**
 * Says the member directory could not be read, with **Try again**: until
 * it is, the authors a page names read "Someone". Nothing while the
 * directory loads or once it has answered.
 */
export function AuthorNamesLoadError({
  organizationId,
  onFocusLost,
}: {
  organizationId: string;
  /** Takes the focus **Try again** held once the names arrive. */
  onFocusLost?: () => void;
}) {
  const { t } = useT('automations');
  const directory = useMembers(organizationId);
  if (!directory.unavailable) return null;
  return (
    <CatalogLoadError
      message={t('versions.author.namesFailed')}
      failureKey={directory.failureCount}
      isRetrying={directory.retrying}
      onRetry={directory.retry}
      {...(onFocusLost !== undefined && { onFocusLost })}
    />
  );
}
