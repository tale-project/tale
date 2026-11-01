'use client';

import type { MentionOption } from '@tale/ui/mentions/mention-options';
import { MentionTextarea as MentionField } from '@tale/ui/mentions/mention-textarea';
import type { MentionRef } from '@tale/ui/mentions/mention-token';
import type { TextareaProps } from '@tale/ui/textarea';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { MENTION_KINDS, type MentionKind } from '@/lib/shared/mention-handles';

import {
  useTaskMentionActors,
  useTaskMentionsPending,
  withTaskActorDirectory,
} from '../hooks/task-actor-directory-context';
import {
  type MentionActorOption,
  useMentionActorOptions,
} from '../lib/mention-actor-options';
import { plainMentionReader } from '../lib/plain-mentions';
import { AssigneeAvatar } from './assignee-avatar';

interface MentionTextareaProps extends Omit<
  TextareaProps,
  'value' | 'defaultValue' | 'onChange' | 'overlay'
> {
  organizationId: string;
  projectId: string;
  /** The text in its stored form: each mention as whom it names. */
  value: string;
  onValueChange: (value: string) => void;
  /** Popover side. Composers at the bottom of a panel want 'above' (default);
   *  fields near the top of a dialog want 'below'. */
  placement?: 'above' | 'below';
  /** Whom the text named when it was saved (a comment being edited): a typed
   * `@handle` shows as one of them, the one it named, or as text. */
  mentions?: ReadonlyArray<{ type: MentionKind; id: string }>;
  /** False for a text whose `@names` are another system's people (a task
   * mirrored from GitHub or GlitchTip): typed handles show as typed. */
  plainMentions?: boolean;
}

const NO_MENTION_OPTIONS: readonly MentionActorOption[] = [];

/** Whether the people handed over answer what is typed after `@`, and
 * whether they are all who do. */
interface CandidatesState {
  /** They do not answer what is typed yet. */
  searching: boolean;
  /** They could not be searched: none offered is no answer. */
  unavailable: boolean;
  /** More match than are offered. */
  more: boolean;
}

const SEARCHING: CandidatesState = {
  searching: true,
  unavailable: false,
  more: false,
};

function sameOptions(
  a: readonly MentionActorOption[],
  b: readonly MentionActorOption[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (option, index) =>
        option.type === b[index]?.type &&
        option.id === b[index]?.id &&
        option.name === b[index]?.name &&
        option.handle === b[index]?.handle,
    )
  );
}

/** Reads the mention candidates for a field that has been focused, for what
 *  is typed after `@` in it, and hands them to it. */
function MentionOptionsSource({
  organizationId,
  projectId,
  query,
  onOptions,
}: {
  organizationId: string;
  projectId: string;
  query: string;
  onOptions: (
    options: readonly MentionActorOption[],
    state: CandidatesState,
  ) => void;
}) {
  const { options, searching, unavailable, more } = useMentionActorOptions(
    organizationId,
    projectId,
    query,
  );
  useEffect(() => {
    onOptions(options, { searching, unavailable, more });
  }, [options, searching, unavailable, more, onOptions]);
  return null;
}

/**
 * The task field that mentions people, agents and automations of the
 * project: `@` opens a picker that finds them by name or handle, and a
 * picked mention reads as `@` and the name while the value it hands back
 * stores whom it names (`@tale/ui/mentions/mention-textarea`). Text written
 * before that — `@handle`s — shows the names of whom the handles name, as
 * the saved text shows them ({@link MentionText}), and keeps the handles as
 * typed: whom one names is the saving server's call.
 */
export const MentionTextarea = withTaskActorDirectory(MentionTextareaContent);

function MentionTextareaContent({
  organizationId,
  projectId,
  id,
  mentions,
  plainMentions = true,
  ...fieldProps
}: MentionTextareaProps) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const index = useTaskMentionActors(organizationId, projectId);
  const pending = useTaskMentionsPending(organizationId, projectId);

  // The mentionable people, agents and automations are read once the field
  // is first focused: a task's comment composer is on screen with every task
  // opened, and reading its candidates then cost every open their requests.
  // The people are searched for what is typed after `@`.
  const [optionsWanted, setOptionsWanted] = useState(false);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] =
    useState<readonly MentionActorOption[]>(NO_MENTION_OPTIONS);
  const [candidatesState, setCandidatesState] =
    useState<CandidatesState>(SEARCHING);
  // The same candidates handed over again change nothing, so a reader that
  // rebuilds its list on every render can never keep this one re-rendering.
  const receiveOptions = useCallback(
    (next: readonly MentionActorOption[], state: CandidatesState) => {
      setCandidates((current) => (sameOptions(current, next) ? current : next));
      setCandidatesState((current) =>
        current.searching === state.searching &&
        current.unavailable === state.unavailable &&
        current.more === state.more
          ? current
          : state,
      );
    },
    [],
  );
  const receiveQuery = useCallback(
    (typed: string | null) => setQuery(typed ?? ''),
    [],
  );
  const options = useMemo<MentionOption<MentionKind>[]>(
    () =>
      candidates.map((candidate) => {
        const handle =
          candidate.handle === undefined ? undefined : `@${candidate.handle}`;
        const kind =
          candidate.type === 'agent'
            ? t('assignee.agents')
            : candidate.type === 'automation'
              ? t('assignee.automations')
              : undefined;
        return {
          kind: candidate.type,
          id: candidate.id,
          name: candidate.name,
          caption:
            candidate.type === 'user'
              ? (candidate.email ?? handle)
              : [handle, kind].filter(Boolean).join(' · '),
          keywords: [
            ...(candidate.handle === undefined ? [] : [candidate.handle]),
            ...(candidate.email === undefined ? [] : [candidate.email]),
            ...(candidate.keywords ?? []),
          ],
          avatar: (
            <AssigneeAvatar
              // The avatar speaks the task worker vocabulary, where an
              // automation is `app`.
              assigneeType={
                candidate.type === 'automation' ? 'app' : candidate.type
              }
              assigneeId={candidate.id}
              name={candidate.name}
            />
          ),
        };
      }),
    [candidates, t],
  );

  // Names come from the directory the task already reads; the field shows a
  // stored mention by today's name until someone starts typing in it.
  const nameOf = useCallback(
    (ref: MentionRef<MentionKind>) => index.byRef(ref)?.name,
    [index],
  );
  const resolvePlain = useMemo(() => {
    const read = plainMentionReader(index, {
      ...(mentions === undefined ? {} : { saved: mentions }),
      plain: plainMentions,
    });
    return (handle: string) => {
      const plain = read(handle);
      if (plain === null) return null;
      if (plain.type === 'actor') {
        const { kind, id: actorId, name } = plain.entry;
        return { kind, id: actorId, name };
      }
      // An agent's id reads as the agent, never as an id; the field writes
      // it back as it was typed.
      return {
        kind: 'agent' as const,
        id: handle,
        name: pending({ handle })
          ? t('mentionChip.kind.agent')
          : t('timeline.deletedAgent'),
      };
    };
  }, [index, mentions, plainMentions, pending, t]);

  return (
    <>
      <MentionField
        {...fieldProps}
        id={id ?? `mention-textarea-${projectId}`}
        kinds={MENTION_KINDS}
        options={options}
        nameOf={nameOf}
        resolvePlain={resolvePlain}
        onOptionsWanted={() => setOptionsWanted(true)}
        onQueryChange={receiveQuery}
        listboxLabel={t('mentionPicker.title')}
        emptyLabel={
          candidatesState.searching
            ? tCommon('actions.loading')
            : t('mentionPicker.empty')
        }
        // Whatever else is offered, a search that failed says so, and so
        // does a page that holds fewer people than match.
        note={
          candidatesState.unavailable
            ? tCommon('peopleSearch.unavailable')
            : candidatesState.more
              ? tCommon('peopleSearch.more')
              : undefined
        }
      />
      {optionsWanted && (
        <MentionOptionsSource
          organizationId={organizationId}
          projectId={projectId}
          query={query}
          onOptions={receiveOptions}
        />
      )}
    </>
  );
}
