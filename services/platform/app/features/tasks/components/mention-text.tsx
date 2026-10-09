'use client';

import { cn } from '@tale/ui/cn';
import { TASK_REMARK_PLUGINS } from '@tale/ui/markdown/remark-plugin-lists';
import { normalizeHtmlBlocks } from '@tale/ui/markdown/streaming/normalize-html-blocks';
import { MentionChip } from '@tale/ui/mentions/mention-chip';
import {
  type MentionElementProps,
  remarkMentions,
} from '@tale/ui/mentions/remark-mentions';
import { type ReactNode, useMemo } from 'react';
import ReactMarkdown, { type Options } from 'react-markdown';

import {
  markdownComponents,
  markdownWrapperStyles,
} from '@/app/features/shared/markdown/markdown-renderer';
import { useT } from '@/lib/i18n/client';
import {
  MENTION_HANDLE_TIER,
  MENTION_KINDS,
  type MentionHandleIndex,
  type MentionKind,
} from '@/lib/shared/mention-handles';

import {
  useTaskMentionActors,
  useTaskMentionsPending,
  withTaskActorDirectory,
} from '../hooks/task-actor-directory-context';
import { type PlainMention, plainMentionReader } from '../lib/plain-mentions';

function isMentionKind(kind: string | undefined): kind is MentionKind {
  return MENTION_KINDS.some((known) => known === kind);
}

interface MentionLabels {
  kind: Record<MentionKind, string>;
  missing: Record<MentionKind, string>;
}

/** One mention: a chip with the current name of whom it names, a muted chip
 * with the name it was saved with for someone gone, never an id. A typed
 * `@handle` nobody answers to stays the words it was. Until the directory
 * has arrived, a stored mention it does not list yet shows the name it was
 * saved with, as a plain chip: nobody is called gone before that is known. */
function MentionElement({
  props,
  written,
  mentions,
  readPlain,
  pending,
  labels,
}: {
  props: MentionElementProps;
  /** The mention as the text spells it. */
  written: ReactNode;
  mentions: MentionHandleIndex;
  readPlain: (handle: string) => PlainMention | null;
  pending: boolean;
  labels: MentionLabels;
}) {
  const kind = props['data-mention-kind'];
  const id = props['data-mention-id'];
  const handle = props['data-mention-handle'];
  const plain =
    id === undefined && handle !== undefined ? readPlain(handle) : null;
  const entry =
    id !== undefined && isMentionKind(kind)
      ? mentions.byRef({ kind, id })
      : plain?.type === 'actor'
        ? plain.entry
        : null;

  if (entry !== null) {
    const agentHandle =
      entry.kind === 'agent'
        ? entry.handles.find(
            (candidate) => candidate.tier === MENTION_HANDLE_TIER.stored,
          )?.handle
        : undefined;
    return (
      <MentionChip
        name={entry.name}
        kindLabel={labels.kind[entry.kind]}
        title={
          entry.kind === 'user'
            ? undefined
            : `${agentHandle === undefined ? '' : `@${agentHandle} · `}${labels.kind[entry.kind]}`
        }
      />
    );
  }
  if (id !== undefined && isMentionKind(kind)) {
    if (pending) {
      return (
        <MentionChip
          name={props['data-mention-label'] || labels.kind[kind]}
          kindLabel={labels.kind[kind]}
        />
      );
    }
    return (
      <MentionChip
        name={props['data-mention-label'] || labels.missing[kind]}
        missing
        missingLabel={labels.missing[kind]}
      />
    );
  }
  if (plain?.type === 'deletedAgent') {
    // An agent's id is never shown: until the agents have arrived it reads
    // as an agent, then by its name or as deleted.
    return pending ? (
      <MentionChip name={labels.kind.agent} kindLabel={labels.kind.agent} />
    ) : (
      <MentionChip
        name={labels.missing.agent}
        missing
        missingLabel={labels.missing.agent}
      />
    );
  }
  return <>{written}</>;
}

/**
 * Task prose — comments and descriptions: GFM markdown via the shared chat
 * renderer, with each mention as a chip that shows whom it names today. It
 * is parsed as the server parses a task text when it is saved
 * (`TASK_REMARK_PLUGINS`), so a chip shows exactly where a mention can have
 * notified someone — never in code or math. Comment threads and the
 * description read view both go through here.
 */
export const MentionText = withTaskActorDirectory(MentionTextContent);

function MentionTextContent({
  body,
  organizationId,
  projectId,
  mentions: savedMentions,
  plainMentions = true,
  className,
}: {
  body: string;
  organizationId: string;
  projectId?: string;
  /** Whom the text named when it was saved (a comment's resolved mentions):
   * a typed `@handle` shows as one of them, the one it named, or as text. */
  mentions?: ReadonlyArray<{ type: MentionKind; id: string }>;
  /** False for a text whose `@names` are another system's people (a task
   * mirrored from GitHub or GlitchTip): typed handles stay text. */
  plainMentions?: boolean;
  className?: string;
}) {
  const { t } = useT('tasks');
  const index = useTaskMentionActors(organizationId, projectId);
  const pending = useTaskMentionsPending(organizationId, projectId);
  const readPlain = useMemo(
    () =>
      plainMentionReader(index, {
        ...(savedMentions === undefined ? {} : { saved: savedMentions }),
        plain: plainMentions,
      }),
    [index, savedMentions, plainMentions],
  );
  const components = useMemo(() => {
    const labels: MentionLabels = {
      kind: {
        user: t('mentionChip.kind.user'),
        agent: t('mentionChip.kind.agent'),
        automation: t('mentionChip.kind.automation'),
      },
      missing: {
        user: t('mentionChip.missing.user'),
        agent: t('timeline.deletedAgent'),
        automation: t('mentionChip.missing.automation'),
      },
    };
    return {
      ...markdownComponents,
      'tale-mention': ({
        node: _node,
        children,
        ...props
      }: MentionElementProps & { node?: unknown; children?: ReactNode }) => (
        <MentionElement
          props={props}
          written={children}
          mentions={index}
          readPlain={readPlain}
          pending={pending}
          labels={labels}
        />
      ),
    };
  }, [index, readPlain, pending, t]);

  // The plugin list is the server's; the HTML-block pre-pass too, so the
  // offsets the plugin reads are the text's own.
  const text = useMemo(() => normalizeHtmlBlocks(body), [body]);

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
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

const REMARK_PLUGINS: Options['remarkPlugins'] = [
  ...TASK_REMARK_PLUGINS,
  [remarkMentions, { kinds: MENTION_KINDS }],
];
