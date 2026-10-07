'use client';

import { cn } from '@tale/ui/cn';
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

import {
  useTaskMentionActors,
  withTaskActorDirectory,
  type TaskMentionActor,
} from '../hooks/task-actor-directory-context';

/** Same boundary rule as the server parser (`convex/tasks/mentions.ts`):
 *  `@` at string start or after whitespace, so emails never match. */
const MENTION_SPLIT_RE = /(^|\s)@([a-zA-Z0-9._/-]+)/g;

/** Split a leaf against the scope's one handle index. Plain text leaves
 * create no components, hooks or directory subscriptions. */
function mentionizedText(
  body: string,
  handleToActor: ReadonlyMap<string, TaskMentionActor>,
  labels: { agents: string; automations: string },
): ReactNode {
  if (!body.includes('@')) return body;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of body.matchAll(MENTION_SPLIT_RE)) {
    const token = match[2];
    const actor = handleToActor.get(token.toLowerCase());
    if (!actor) continue;
    const mentionStart = match.index + match[1].length;
    if (mentionStart > cursor) parts.push(body.slice(cursor, mentionStart));
    parts.push(
      <span
        key={`${mentionStart}-${token}`}
        className="bg-primary/10 text-primary rounded-md box-decoration-clone px-1 py-0.5 text-[0.9em] leading-none font-medium"
        title={
          actor.kind === 'agent'
            ? `@${token} · ${labels.agents}`
            : actor.kind === 'automation'
              ? `@${token} · ${labels.automations}`
              : `@${token}`
        }
      >
        @{actor.name}
      </span>,
    );
    cursor = mentionStart + token.length + 1;
  }
  if (cursor === 0) return body;
  if (cursor < body.length) parts.push(body.slice(cursor));
  return parts.map((node, index) =>
    typeof node === 'string' ? <Fragment key={index}>{node}</Fragment> : node,
  );
}

/** Mentionize string leaves under a markdown block (p / li). Nested
 *  elements (strong, em, code) keep their own children — mentions almost
 *  always sit in adjacent text nodes, not inside emphasis. */
function mentionizeChildren(
  children: ReactNode,
  handles: ReadonlyMap<string, TaskMentionActor>,
  labels: { agents: string; automations: string },
): ReactNode {
  return Children.map(children, (child) =>
    typeof child === 'string' ? mentionizedText(child, handles, labels) : child,
  );
}

/**
 * Task-prose wrapper: GFM markdown via the shared chat renderer, with
 * `@handle` pills on text nodes. Comment threads and the description read
 * view both go through here.
 */
export const MentionText = withTaskActorDirectory(MentionTextContent);

function MentionTextContent({
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
  const { t } = useT('tasks');
  const handles = useTaskMentionActors(organizationId, projectId);
  const components = useMemo(() => {
    const labels = {
      agents: t('assignee.agents'),
      automations: t('assignee.automations'),
    };
    return {
      ...markdownComponents,
      p: ({
        node: _node,
        children,
        ...props
      }: {
        node?: unknown;
        children?: ReactNode;
      } & React.HTMLAttributes<HTMLParagraphElement>) => (
        <p {...props}>{mentionizeChildren(children, handles, labels)}</p>
      ),
      li: ({
        node: _node,
        children,
        ...props
      }: {
        node?: unknown;
        children?: ReactNode;
      } & React.LiHTMLAttributes<HTMLLIElement>) => (
        <li {...props}>{mentionizeChildren(children, handles, labels)}</li>
      ),
    };
  }, [handles, t]);

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
