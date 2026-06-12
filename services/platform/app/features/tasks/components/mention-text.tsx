'use client';

import { Text } from '@tale/ui/text';
import { Fragment, useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

import { useActorDirectory } from '../hooks/use-actor-directory';
import { memberHandleVariants } from '../lib/mention-handles';

/** Same boundary rule as the server parser (`convex/tasks/mentions.ts`):
 *  `@` at string start or after whitespace, so emails never match. */
const MENTION_SPLIT_RE = /(^|\s)@([a-zA-Z0-9._-]+)/g;

interface ResolvedHandle {
  name: string;
  isAgent: boolean;
}

/**
 * Plain text with `@handle` mentions rendered as display-name pills —
 * `@chat-agent` reads as a `@Assistant` badge once the handle resolves
 * against the org directory. Returns an inline fragment (no block wrapper),
 * so any plain-text surface — task prose via {@link MentionText}, chat user
 * bubbles — can adopt it inside its own typography. The underlying text
 * keeps the raw handle (that's what the server parses); the swap is purely
 * presentational, with the typed handle preserved in the pill's tooltip.
 * Unresolvable tokens render verbatim. `organizationId` must be non-empty
 * (the directory queries fire unconditionally).
 */
export function MentionizedText({
  body,
  organizationId,
  projectId,
}: {
  body: string;
  organizationId: string;
  projectId?: string;
}) {
  const { t } = useT('tasks');
  const { members, agents } = useActorDirectory(organizationId, projectId);

  // Members first, agents after — on a handle collision the agent wins,
  // matching the server's directory build order.
  const handleToActor = useMemo(() => {
    const map = new Map<string, ResolvedHandle>();
    for (const member of members) {
      for (const variant of memberHandleVariants(member)) {
        map.set(variant, { name: member.name, isAgent: false });
      }
    }
    for (const agent of agents) {
      map.set(agent.id.toLowerCase(), { name: agent.name, isAgent: true });
    }
    return map;
  }, [members, agents]);

  const nodes = useMemo(() => {
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    for (const match of body.matchAll(MENTION_SPLIT_RE)) {
      const token = match[2];
      const actor = handleToActor.get(token.toLowerCase());
      if (!actor) continue;
      const mentionStart = match.index + match[1].length;
      if (mentionStart > cursor) parts.push(body.slice(cursor, mentionStart));
      parts.push(
        // Inline pill so a resolved mention is unmistakably a person/agent
        // reference, not prose. Sized in em so it scales with the text.
        <span
          key={`${mentionStart}-${token}`}
          className="bg-primary/10 text-primary rounded-md box-decoration-clone px-1 py-0.5 text-[0.9em] leading-none font-medium"
          title={
            actor.isAgent ? `@${token} · ${t('assignee.agents')}` : `@${token}`
          }
        >
          @{actor.name}
        </span>,
      );
      cursor = mentionStart + token.length + 1;
    }
    if (cursor < body.length) parts.push(body.slice(cursor));
    return parts;
  }, [body, handleToActor, t]);

  return (
    <>
      {nodes.map((node, index) =>
        typeof node === 'string' ? (
          // oxlint-disable-next-line react/no-array-index-key -- static split segments, order-stable per body
          <Fragment key={index}>{node}</Fragment>
        ) : (
          node
        ),
      )}
    </>
  );
}

/**
 * Task-prose wrapper for {@link MentionizedText}: comment bodies and the
 * description read view render through the shared `Text` body typography.
 */
export function MentionText({
  body,
  organizationId,
  projectId,
  className,
}: {
  body: string;
  organizationId: string;
  projectId?: string;
  className?: string;
}) {
  return (
    <Text as="p" variant="body" className={className}>
      <MentionizedText
        body={body}
        organizationId={organizationId}
        projectId={projectId}
      />
    </Text>
  );
}
