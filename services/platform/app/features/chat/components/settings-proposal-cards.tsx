'use client';

/**
 * The changes to projects and agents a reply proposed, as cards under it.
 *
 * The chat's `propose_project_settings` tool changes nothing: it keeps a
 * checked proposal (`backend/domains/chat/proposals.ts`) that this card
 * shows field by field — a new project's or agent's settings, or each
 * changed field before and after, instructions as a diff. **Apply** makes
 * exactly that change, as the person, through the same services as the
 * pages; **Dismiss** leaves everything as it was. The card keeps what
 * happened after a reload, with a link to what an apply made or changed.
 * A colleague reading a chat shared with its project sees the cards but
 * cannot decide them.
 */

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { FieldChangeRow } from '@tale/ui/change-list';
import type { CodeDiffProps } from '@tale/ui/code-diff';
import { Stack } from '@tale/ui/layout';
import { lazyComponent } from '@tale/ui/lazy-component';
import { ReadMore } from '@tale/ui/read-more';
import { Text } from '@tale/ui/text';
import { toast } from '@tale/ui/use-toast';
import { Link } from '@tanstack/react-router';
import { Bot, FolderKanban, Loader2 } from 'lucide-react';
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import { failureDetail } from '@/app/lib/backend/adapters';
import {
  type ChatProposalView,
  PROPOSE_PROJECT_SETTINGS,
  type ProposalChatAgent,
  type ProposalFailure,
  type ProposalField,
} from '@/lib/chat/settings-tools';
import { useT } from '@/lib/i18n/client';

import { useChatProposals, useProposalDecision } from '../data/chat-backend';
import type { MessagePart } from '../types';

/** The diff of changed instructions loads with the first card that shows
 * one: the diff viewer stays out of the chat's own code. */
const CodeDiff = lazyComponent<CodeDiffProps>(
  () =>
    import('@tale/ui/code-diff').then((module) => ({
      default: module.CodeDiff,
    })),
  {
    loading: () => (
      <div className="bg-muted h-24 animate-pulse rounded-md motion-reduce:animate-none" />
    ),
  },
);

/** Whether the person reading may apply and dismiss the conversation's
 * proposals: its owner, on a chat that is not archived. */
export const ChatProposalDecisionContext = createContext<boolean>(false);

/** The conversation the transcript shows, to read its proposals by — also
 * where a reader of a shared chat has no per-message thread actions. */
export const ChatProposalThreadContext = createContext<string | undefined>(
  undefined,
);

/** The proposals a reply made, in the order it made them. */
export function proposalIdsOf(parts: readonly MessagePart[]): string[] {
  const ids: string[] = [];
  for (const part of parts) {
    if (
      part.type !== 'tool-result' ||
      part.capabilityId !== PROPOSE_PROJECT_SETTINGS
    ) {
      continue;
    }
    const output = part.output;
    if (output === null || typeof output !== 'object') continue;
    const record = output as { status?: unknown; proposalId?: unknown };
    if (record.status === 'ok' && typeof record.proposalId === 'string') {
      ids.push(record.proposalId);
    }
  }
  return ids;
}

/** Explicit key maps so the i18n usage check sees every catalog key. */
const FIELD_LABEL_KEY: Record<ProposalField['field'], string> = {
  name: 'proposal.field.name',
  key: 'proposal.field.key',
  description: 'proposal.field.description',
  instructions: 'proposal.field.instructions',
  model: 'proposal.field.model',
  runtime: 'proposal.field.runtime',
  skills: 'proposal.field.skills',
  defaultChatAgent: 'proposal.field.defaultChatAgent',
};

const STATUS_KEY: Record<ChatProposalView['status'], string> = {
  pending: 'proposal.status.pending',
  applied: 'proposal.status.applied',
  dismissed: 'proposal.status.dismissed',
  failed: 'proposal.status.failed',
};

const SPINNING = 'animate-spin motion-reduce:animate-none';

const STATUS_VARIANT: Record<
  ChatProposalView['status'],
  'outline' | 'green' | 'slate' | 'destructive'
> = {
  pending: 'outline',
  applied: 'green',
  dismissed: 'slate',
  failed: 'destructive',
};

const FAILURE_KEY: Record<ProposalFailure, string> = {
  stale: 'proposal.failure.stale',
  gone: 'proposal.failure.gone',
  forbidden: 'proposal.failure.forbidden',
  archived: 'proposal.failure.archived',
  nameTaken: 'proposal.failure.nameTaken',
  keyTaken: 'proposal.failure.keyTaken',
  model: 'proposal.failure.model',
  skills: 'proposal.failure.skills',
  limit: 'proposal.failure.limit',
  invalid: 'proposal.failure.invalid',
};

export function SettingsProposalCards({
  parts,
  organizationId,
  threadId,
}: {
  parts: readonly MessagePart[];
  organizationId?: string;
  threadId?: string;
}) {
  const { t } = useT('chat');
  const transcriptThreadId = useContext(ChatProposalThreadContext);
  const readThreadId = threadId ?? transcriptThreadId;
  const ids = useMemo(() => proposalIdsOf(parts), [parts]);
  const proposals = useChatProposals(
    organizationId ?? '',
    ids.length === 0 || organizationId === undefined ? undefined : readThreadId,
    ids,
  );
  if (ids.length === 0 || organizationId === undefined) return null;
  if (proposals.status === 'unavailable') {
    return (
      <Text variant="caption" className="mt-2">
        {t('proposal.loadFailed')}
      </Text>
    );
  }
  const byId = new Map(
    (proposals.status === 'ready' ? proposals.data : []).map(
      (proposal) => [proposal.id, proposal] as const,
    ),
  );
  return (
    <Stack gap={2} className="mt-2">
      {ids.map((id) => {
        const proposal = byId.get(id);
        return proposal === undefined ? null : (
          <ProposalCard
            key={id}
            proposal={proposal}
            organizationId={organizationId}
          />
        );
      })}
    </Stack>
  );
}

function ProposalCard({
  proposal: stored,
  organizationId,
}: {
  proposal: ChatProposalView;
  organizationId: string;
}) {
  const { t } = useT('chat');
  const canDecide = useContext(ChatProposalDecisionContext);
  const { decide } = useProposalDecision(organizationId);
  const [busy, setBusy] = useState<'apply' | 'dismiss' | null>(null);
  const cardRef = useRef<HTMLElement>(null);
  // A decision removes the buttons: focus that was on them moves to the
  // card, which now says what happened, rather than to the page.
  const [refocus, setRefocus] = useState(false);
  // The answer of this tab's own decision, until the read catches up.
  const [decided, setDecided] = useState<ChatProposalView | null>(null);
  const proposal =
    decided !== null && stored.status === 'pending' ? decided : stored;
  const pending = proposal.status === 'pending';
  const creates =
    proposal.kind === 'create_project' || proposal.kind === 'create_agent';
  const title =
    proposal.kind === 'create_project'
      ? t('proposal.title.createProject')
      : proposal.kind === 'update_project'
        ? t('proposal.title.updateProject', {
            name: proposal.projectName ?? '',
          })
        : proposal.kind === 'create_agent'
          ? t('proposal.title.createAgent', {
              project: proposal.projectName ?? '',
            })
          : t('proposal.title.updateAgent', {
              name: proposal.agentName ?? '',
            });
  const Icon =
    proposal.kind === 'create_project' || proposal.kind === 'update_project'
      ? FolderKanban
      : Bot;
  const titleId = useId();
  const statusId = useId();
  const reasonId = useId();
  const failed = proposal.status === 'failed';

  useEffect(() => {
    if (!refocus || pending) return;
    setRefocus(false);
    cardRef.current?.focus();
  }, [pending, refocus]);

  const run = (decision: 'apply' | 'dismiss') => {
    if (busy !== null) return;
    const hadFocus =
      cardRef.current?.contains(document.activeElement ?? null) === true;
    setBusy(decision);
    decide(proposal.id, decision)
      .then(
        (outcome) => {
          setDecided(outcome);
          if (hadFocus) setRefocus(true);
          // The card says why, in place; the toast says that it did not apply.
          if (outcome.status === 'failed') {
            toast({ title: t('proposal.applyFailed'), variant: 'destructive' });
          }
        },
        (error: unknown) => {
          console.warn('[chat] a proposal could not be decided', error);
          toast({
            title:
              decision === 'apply'
                ? t('proposal.applyFailed')
                : t('proposal.dismissFailed'),
            ...(failureDetail(error) !== undefined
              ? { description: failureDetail(error) }
              : {}),
            variant: 'destructive',
          });
        },
      )
      .finally(() => setBusy(null));
  };

  const link =
    proposal.status !== 'applied' || proposal.projectId === undefined
      ? undefined
      : proposal.kind === 'create_agent' || proposal.kind === 'update_agent'
        ? {
            to: '/dashboard/$id/projects/$projectId/agents' as const,
            label: t('proposal.openAgents'),
          }
        : {
            to: '/dashboard/$id/projects/$projectId/overview' as const,
            label: t('proposal.openProject'),
          };

  return (
    <section
      ref={cardRef}
      tabIndex={-1}
      aria-labelledby={titleId}
      // The status, and why it failed, are read with the card — also when
      // a decision has just moved the focus to it.
      aria-describedby={failed ? `${statusId} ${reasonId}` : statusId}
      data-testid="settings-proposal"
      data-status={proposal.status}
      className="border-border bg-background focus-visible:ring-ring w-full max-w-xl rounded-lg border p-3 outline-none focus-visible:ring-1"
    >
      <Stack gap={3}>
        <div className="flex min-w-0 items-center gap-2">
          <Icon aria-hidden className="text-muted-foreground size-4 shrink-0" />
          <Text
            as="h3"
            id={titleId}
            variant="label"
            className="min-w-0 truncate"
          >
            {title}
          </Text>
          <Badge
            id={statusId}
            variant={STATUS_VARIANT[proposal.status]}
            className="ml-auto shrink-0 px-1.5 py-0 text-[11px]"
          >
            {t(STATUS_KEY[proposal.status])}
          </Badge>
        </div>
        <Stack gap={2}>
          {proposal.fields.map((field) => (
            <ProposalFieldRow
              key={field.field}
              field={field}
              creates={creates}
            />
          ))}
        </Stack>
        {failed && (
          <Text id={reasonId} variant="caption" className="text-destructive">
            {t(FAILURE_KEY[proposal.failure?.reason ?? 'invalid'])}
          </Text>
        )}
        {pending && proposal.kind === 'create_project' && (
          <Text variant="caption">{t('proposal.orgWide')}</Text>
        )}
        {pending && canDecide && (
          <Text variant="caption">{t('proposal.nothingYet')}</Text>
        )}
        {pending && canDecide && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Busy, the buttons keep the focus: a natively disabled
                button would drop it to the page. */}
            <Button
              size="sm"
              onClick={() => run('apply')}
              {...(busy === 'apply'
                ? { icon: Loader2, iconClassName: SPINNING }
                : {})}
              aria-busy={busy === 'apply' || undefined}
              aria-disabled={busy !== null || undefined}
            >
              {t('proposal.apply')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => run('dismiss')}
              {...(busy === 'dismiss'
                ? { icon: Loader2, iconClassName: SPINNING }
                : {})}
              aria-busy={busy === 'dismiss' || undefined}
              aria-disabled={busy !== null || undefined}
            >
              {t('proposal.dismiss')}
            </Button>
          </div>
        )}
        {link !== undefined && proposal.projectId !== undefined && (
          <Link
            to={link.to}
            params={{ id: organizationId, projectId: proposal.projectId }}
            className="text-info-foreground text-sm hover:underline"
          >
            {link.label}
          </Link>
        )}
      </Stack>
    </section>
  );
}

/** Who answers in new chats, in the person's language. */
function useChatAgentText(): (
  choice: ProposalChatAgent | undefined,
) => string | undefined {
  const { t } = useT('chat');
  return (choice) => {
    if (choice === undefined) return undefined;
    if (choice.kind === 'assistant') return t('proposal.chatAgent.assistant');
    if (choice.kind === 'agent') return choice.name;
    return choice.name === undefined
      ? t('proposal.chatAgent.first')
      : t('proposal.chatAgent.firstNamed', { name: choice.name });
  };
}

/** One field: the value a new project or agent gets, or what a field is and
 * what it becomes. Changed instructions read as a diff; long new text sits
 * behind Read more. */
function ProposalFieldRow({
  field,
  creates,
}: {
  field: ProposalField;
  creates: boolean;
}) {
  const { t } = useT('chat');
  const chatAgentText = useChatAgentText();
  const label = t(FIELD_LABEL_KEY[field.field]);
  const empty = t(
    field.field === 'skills' ? 'proposal.none' : 'proposal.empty',
  );
  const shown = (value: string) => (value === '' ? empty : value);
  const value = chatAgentText(field.chatAgent) ?? shown(field.value);
  const before =
    chatAgentText(field.chatAgentBefore) ??
    (field.before === undefined ? undefined : shown(field.before));
  const long = field.field === 'description' || field.field === 'instructions';

  if (creates || before === undefined) {
    // A new project's or agent's value: nothing to compare it with.
    return long ? (
      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <span className="text-muted-foreground">{label}</span>
        {field.field === 'instructions' ? (
          <ReadMore maxHeight={120}>
            <p className="break-words whitespace-pre-wrap">{value}</p>
          </ReadMore>
        ) : (
          <p className="break-words">{value}</p>
        )}
      </div>
    ) : (
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
        <span className="text-muted-foreground shrink-0">{label}</span>
        <span className="min-w-0 break-words">{value}</span>
      </div>
    );
  }
  if (field.field === 'instructions') {
    return (
      <FieldChangeRow
        label={label}
        kind="changed"
        detail={
          <CodeDiff
            before={field.before ?? ''}
            after={field.value}
            language="markdown"
            beforeLabel={t('proposal.before')}
            afterLabel={t('proposal.after')}
            toolbar={false}
            lineNumbers={false}
            context={2}
            maxHeight="16rem"
            aria-label={label}
          />
        }
      />
    );
  }
  return (
    <FieldChangeRow
      label={label}
      kind="changed"
      layout={long ? 'stacked' : 'inline'}
      before={before}
      after={value}
    />
  );
}
