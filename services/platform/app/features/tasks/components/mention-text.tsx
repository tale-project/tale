'use client';

/**
 * Task / description prose: GFM markdown (shared chat renderer) with
 * `@handle` mention pills overlaid on text nodes. Workflow and agent comments
 * ship real markdown; user comments stay readable and keep mention chips.
 */
import { Children, Fragment, useMemo, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import {
  markdownComponents,
  markdownWrapperStyles,
} from '@/app/features/shared/markdown/markdown-renderer';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useActorDirectory } from '../hooks/use-actor-directory';
import {
  agentHandleVariants,
  automationHandleVariants,
  memberHandleVariants,
} from '../lib/mention-handles';

/** Same boundary rule as the server parser (`convex/tasks/mentions.ts`):
 *  `@` at string start or after whitespace, so emails never match. */
const MENTION_SPLIT_RE = /(^|\s)@([a-zA-Z0-9._/-]+)/g;

interface ResolvedHandle {
  name: string;
  kind: 'user' | 'agent' | 'automation';
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
  const { members, agents, automations } = useActorDirectory(
    organizationId,
    projectId,
  );

  // Members first, then automations, agents last — on a handle collision the
  // later entry wins, matching the server's directory build order (agent
  // instances keep the strongest claim).
  const handleToActor = useMemo(() => {
    const map = new Map<string, ResolvedHandle>();
    for (const member of members) {
      for (const variant of memberHandleVariants(member)) {
        map.set(variant, { name: member.name, kind: 'user' });
      }
    }
    for (const automation of automations) {
      for (const variant of automationHandleVariants(automation)) {
        map.set(variant, { name: automation.name, kind: 'automation' });
      }
    }
    for (const agent of agents) {
      for (const variant of agentHandleVariants(agent)) {
        map.set(variant, { name: agent.name, kind: 'agent' });
      }
    }
    return map;
  }, [members, agents, automations]);

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
            actor.kind === 'agent'
              ? `@${token} · ${t('assignee.agents')}`
              : actor.kind === 'automation'
                ? `@${token} · ${t('assignee.automations')}`
                : `@${token}`
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

/** Mentionize string leaves under a markdown block (p / li). Nested
 *  elements (strong, em, code) keep their own children — mentions almost
 *  always sit in adjacent text nodes, not inside emphasis. */
function mentionizeChildren(
  children: ReactNode,
  organizationId: string,
  projectId: string | undefined,
): ReactNode {
  return Children.map(children, (child, index) => {
    if (typeof child !== 'string') return child;
    return (
      <MentionizedText
        // oxlint-disable-next-line react/no-array-index-key -- leaf order stable per render
        key={index}
        body={child}
        organizationId={organizationId}
        projectId={projectId}
      />
    );
  });
}

/**
 * Task-prose wrapper: GFM markdown via the shared chat renderer, with
 * `@handle` pills on text nodes. Comment threads and the description read
 * view both go through here.
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
  const components = useMemo(
    () => ({
      ...markdownComponents,
      p: ({
        node: _node,
        children,
        ...props
      }: {
        node?: unknown;
        children?: ReactNode;
      } & React.HTMLAttributes<HTMLParagraphElement>) => (
        <p {...props}>
          {mentionizeChildren(children, organizationId, projectId)}
        </p>
      ),
      li: ({
        node: _node,
        children,
        ...props
      }: {
        node?: unknown;
        children?: ReactNode;
      } & React.LiHTMLAttributes<HTMLLIElement>) => (
        <li {...props}>
          {mentionizeChildren(children, organizationId, projectId)}
        </li>
      ),
    }),
    [organizationId, projectId],
  );

  return (
    <div
      className={cn(
        'text-sm',
        markdownWrapperStyles,
        // Comment / description density — chat h1/h2 sizes are too loud here.
        '[&_h1]:mt-2 [&_h1]:text-base [&_h2]:mt-2 [&_h2]:text-sm [&_h3]:mt-2 [&_h3]:text-sm',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {body}
      </ReactMarkdown>
    </div>
  );
}
