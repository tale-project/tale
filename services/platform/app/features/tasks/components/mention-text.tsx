'use client';

import { cn } from '@tale/ui/cn';
/**
 * Task / description prose: GFM markdown (shared chat renderer) with
 * `@handle` mention pills overlaid on text nodes. Workflow and agent comments
 * ship real markdown; user comments stay readable and keep mention chips.
 */
import {
  Children,
  createContext,
  Fragment,
  memo,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import {
  markdownComponents,
  markdownWrapperStyles,
} from '@/app/features/shared/markdown/markdown-renderer';
import { useT } from '@/lib/i18n/client';

import {
  useActorDirectory,
  useProvidedActorDirectory,
  type ActorDirectory,
} from '../hooks/use-actor-directory';
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

/** What every text run of one body resolves its `@handles` against. */
interface MentionHandles {
  byHandle: ReadonlyMap<string, ResolvedHandle>;
  /** The pill tooltip's kind words for an agent and an automation. */
  agentLabel: string;
  automationLabel: string;
}

const MentionHandlesContext = createContext<MentionHandles>({
  byHandle: new Map(),
  agentLabel: '',
  automationLabel: '',
});

/**
 * Plain text with `@handle` mentions rendered as display-name pills —
 * `@chat-agent` reads as a `@Assistant` badge once the handle resolves
 * against the org directory. Returns an inline fragment (no block wrapper),
 * so it sits inside its paragraph's own typography. The underlying text
 * keeps the raw handle (that's what the server parses); the swap is purely
 * presentational, with the typed handle preserved in the pill's tooltip.
 * Unresolvable tokens render verbatim. The handles come from the body's
 * {@link MentionText}, built once for all of its text runs.
 */
function MentionizedText({ body }: { body: string }) {
  const { byHandle, agentLabel, automationLabel } = useContext(
    MentionHandlesContext,
  );

  const nodes = useMemo(() => {
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    for (const match of body.matchAll(MENTION_SPLIT_RE)) {
      const token = match[2];
      const actor = byHandle.get(token.toLowerCase());
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
              ? `@${token} · ${agentLabel}`
              : actor.kind === 'automation'
                ? `@${token} · ${automationLabel}`
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
  }, [body, byHandle, agentLabel, automationLabel]);

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
function mentionizeChildren(children: ReactNode): ReactNode {
  return Children.map(children, (child, index) => {
    if (typeof child !== 'string') return child;
    return (
      <MentionizedText
        // oxlint-disable-next-line react/no-array-index-key -- leaf order stable per render
        key={index}
        body={child}
      />
    );
  });
}

/** The markdown renderer's block overrides: paragraphs and list items
 *  mentionize their text runs. Module-level, so every body shares one map. */
const mentionComponents = {
  ...markdownComponents,
  p: ({
    node: _node,
    children,
    ...props
  }: {
    node?: unknown;
    children?: ReactNode;
  } & React.HTMLAttributes<HTMLParagraphElement>) => (
    <p {...props}>{mentionizeChildren(children)}</p>
  ),
  li: ({
    node: _node,
    children,
    ...props
  }: {
    node?: unknown;
    children?: ReactNode;
  } & React.LiHTMLAttributes<HTMLLIElement>) => (
    <li {...props}>{mentionizeChildren(children)}</li>
  ),
};

interface MentionTextProps {
  body: string;
  organizationId: string;
  projectId?: string;
  className?: string;
}

/**
 * Task-prose wrapper: GFM markdown via the shared chat renderer, with
 * `@handle` pills on text nodes. Comment threads and the description read
 * view both go through here. It names people from the actor directory an
 * `ActorDirectoryProvider` above provides — a task's comments render
 * hundreds of these — and reads its own only where none does. Memoized: a
 * re-render of the list around it re-parses no markdown.
 */
export const MentionText = memo(function MentionText(props: MentionTextProps) {
  const provided = useProvidedActorDirectory(
    props.organizationId,
    props.projectId,
  );
  return provided !== undefined ? (
    <MentionMarkdown {...props} directory={provided} />
  ) : (
    <MentionTextWithOwnDirectory {...props} />
  );
});

function MentionTextWithOwnDirectory(props: MentionTextProps) {
  const directory = useActorDirectory(props.organizationId, props.projectId);
  return <MentionMarkdown {...props} directory={directory} />;
}

function MentionMarkdown({
  body,
  className,
  directory: { members, agents, automations },
}: MentionTextProps & {
  directory: Pick<ActorDirectory, 'members' | 'agents' | 'automations'>;
}) {
  const { t } = useT('tasks');
  // Members first, then automations, agents last — on a handle collision the
  // later entry wins, matching the server's directory build order (agent
  // instances keep the strongest claim).
  const byHandle = useMemo(() => {
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
  const agentLabel = t('assignee.agents');
  const automationLabel = t('assignee.automations');
  const handles = useMemo(
    () => ({ byHandle, agentLabel, automationLabel }),
    [byHandle, agentLabel, automationLabel],
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
      <MentionHandlesContext.Provider value={handles}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={mentionComponents}
        >
          {body}
        </ReactMarkdown>
      </MentionHandlesContext.Provider>
    </div>
  );
}
