'use client';

/**
 * Connected `MessageComposer` block — the reply box under a
 * ConversationThread. A rich (Milkdown) editor whose draft is dispatched
 * through the bound `submit` action as `ctx.input = { body }` (the authored
 * args read it via `$input.body` — e.g. `content: '$input.body'` for
 * `replyToConversation`). The draft is MARKDOWN while editing; at submit it
 * is serialized to sanitized HTML (`markdownToHtml`) — the body contract the
 * old inbox editor established and `replyToConversation`'s html/text split
 * still assumes. The `improve` action is fed the raw markdown instead, like
 * the old `improveMessage` was.
 *
 * `requiresState` names the view-state key that must be set before the
 * composer enables (the master list's selection); until then the block shows
 * the awaiting-selection placeholder (`placeholderKey` overrides the copy).
 * Drafts are kept PER conversation id — switching the selection preserves
 * each conversation's in-progress text. The optional `improve` action
 * (e.g. `improveMessage`, fed the markdown via `$input.body`) replaces the
 * draft with the returned suggestion and offers a one-shot Undo back to the
 * previous text. `enabledWhen` (when_predicate grammar) evaluates against the
 * view-state record and disables the composer when false. Cmd/Ctrl+Enter
 * submits; a successful send clears the draft and fires the `onSuccess`
 * effect(s).
 *
 * The editor is uncontrolled — programmatic content changes (draft switch,
 * improve, undo, clear-on-send) remount it via `key = draftKey#reset`, the
 * same remount mechanics the old inbox editor used after a send.
 */
import type { Fields, PuckComponent } from '@measured/puck';
import { Button } from '@tale/ui/button';
import { Center, Row } from '@tale/ui/layout';
import { Loader2Icon } from 'lucide-react';
import { useState } from 'react';
import type { z } from 'zod';

import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { evaluateWhen } from '@/lib/shared/platform/when_predicate';
import type {
  actionEffectSchema,
  BoundActionSpec,
} from '@/lib/shared/schemas/automation_views';
import { lazyComponent } from '@/lib/utils/lazy-component';
import { isRecord } from '@/lib/utils/type-utils';

import { useBoundAction } from '../../hooks/use-bound-action';
import { useActionEffect } from '../../runtime/action-effects';
import { useOptionalViewState } from '../../runtime/view-state';
import { BindingStates, BlockFrame } from '../block-frame';
import { markdownToHtml } from './conversation-parts/rich-editor/markdown-to-html';
import type { RichMessageEditorProps } from './conversation-parts/rich-editor/rich-message-editor';

// Milkdown is browser-only — lazy-mount it with the same spinner the old
// inbox used so a server pass never touches Crepe or its theme CSS.
const RichMessageEditor = lazyComponent<RichMessageEditorProps>(
  () =>
    import('./conversation-parts/rich-editor/rich-message-editor').then(
      (mod) => ({ default: mod.RichMessageEditor }),
    ),
  {
    loading: () => (
      <Center className="p-4">
        <Loader2Icon className="text-muted-foreground size-6 animate-spin" />
      </Center>
    ),
  },
);

export interface MessageComposerProps {
  /**
   * The send action — its args read the composer's serialized HTML body via
   * `$input.body`.
   */
  submit: BoundActionSpec;
  /** Optional improve-with-AI action (e.g. `improveMessage`), fed markdown. */
  improve?: BoundActionSpec;
  /** View-state key that must be set before the composer enables. */
  requiresState?: string;
  placeholderKey?: string;
  submitLabelKey?: string;
  /** Availability predicate (when_predicate) over the view-state record. */
  enabledWhen?: string;
  onSuccess?: z.infer<typeof actionEffectSchema>;
}

/** Read an improve action's suggestion: `{ improvedMessage }` or a bare string. */
export function readImprovedMessage(result: unknown): string | undefined {
  if (typeof result === 'string') return result;
  if (isRecord(result) && typeof result.improvedMessage === 'string') {
    return result.improvedMessage;
  }
  return undefined;
}

/** A set view-state value — `undefined`/`null`/`''` all read as "no selection". */
function stateValueSet(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

export function MessageComposer({
  submit,
  improve,
  requiresState,
  placeholderKey,
  submitLabelKey,
  enabledWhen,
  onSuccess,
}: MessageComposerProps) {
  const { t } = useT('automations');
  const viewState = useOptionalViewState();
  const applyEffect = useActionEffect();

  const submitAction = useBoundAction(submit.path, submit.mode);
  // Hooks run unconditionally: an absent `improve` binds the empty (invalid)
  // path; `improveDispatch` is only called when `improve` is configured.
  const improveAction = useBoundAction(
    improve?.path ?? '',
    improve?.mode ?? 'action',
  );

  // Drafts (markdown) + one-shot undo snapshots, PER conversation id —
  // switching the master selection preserves each conversation's in-progress
  // text. `resets` remounts the uncontrolled editor whenever a draft is
  // replaced programmatically (improve, undo, clear-on-send).
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [undoSnapshots, setUndoSnapshots] = useState<Record<string, string>>(
    {},
  );
  const [resets, setResets] = useState<Record<string, number>>({});

  const stateValue = requiresState
    ? viewState?.state[requiresState]
    : undefined;
  const awaiting = requiresState !== undefined && !stateValueSet(stateValue);
  const draftKey = requiresState ? String(stateValue) : 'default';
  const draft = drafts[draftKey] ?? '';
  const undoText = undoSnapshots[draftKey];

  const enabled =
    enabledWhen === undefined ||
    evaluateWhen(enabledWhen, viewState?.state ?? {});

  const pending = submitAction.isPending || improveAction.isPending;
  const canSend = enabled && !pending && draft.trim() !== '';

  const setDraft = (value: string) =>
    setDrafts((prev) => ({ ...prev, [draftKey]: value }));

  const bumpReset = () =>
    setResets((prev) => ({ ...prev, [draftKey]: (prev[draftKey] ?? 0) + 1 }));

  const handleSubmit = async () => {
    const markdown = draft.trim();
    if (!canSend || markdown === '') return;
    // The reply body contract is HTML — the old inbox editor serialized its
    // markdown before handing it to the send path, and `replyToConversation`
    // still splits `content` into { html, text } on that assumption. Markdown
    // that renders to nothing (e.g. `***`) blocks the send, as before.
    const body = markdownToHtml(markdown);
    if (body.trim() === '') return;
    try {
      const result = await submitAction.dispatch(submit.args, undefined, {
        input: { body },
      });
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[draftKey];
        return next;
      });
      setUndoSnapshots((prev) => {
        const next = { ...prev };
        delete next[draftKey];
        return next;
      });
      bumpReset();
      applyEffect(submit.onSuccess, result);
      applyEffect(onSuccess, result);
    } catch (err) {
      // The mutation/action layer (useConvexMutation) already toasts + logs;
      // surface it here too rather than swallowing the rejection. The draft
      // stays so nothing typed is lost.
      console.error(
        '[automation-binding] composer submit failed',
        submit.path,
        err,
      );
    }
  };

  const handleImprove = async () => {
    const body = draft.trim();
    if (!improve || pending || body === '') return;
    try {
      const result = await improveAction.dispatch(improve.args, undefined, {
        input: { body },
      });
      if (isRecord(result) && typeof result.error === 'string') {
        toast({ title: t('composer.improveFailed'), variant: 'destructive' });
        return;
      }
      const improved = readImprovedMessage(result);
      if (improved !== undefined && improved !== draft) {
        setUndoSnapshots((prev) => ({ ...prev, [draftKey]: draft }));
        setDraft(improved);
        bumpReset();
      }
    } catch (err) {
      console.error('[automation-binding] improve failed', improve.path, err);
      toast({ title: t('composer.improveFailed'), variant: 'destructive' });
    }
  };

  const handleUndo = () => {
    if (undoText === undefined) return;
    setDraft(undoText);
    setUndoSnapshots((prev) => {
      const next = { ...prev };
      delete next[draftKey];
      return next;
    });
    bumpReset();
  };

  const placeholder = placeholderKey ?? t('composer.placeholder');
  const submitLabel = submitLabelKey ?? submit.label ?? t('composer.send');

  return (
    <BlockFrame>
      <BindingStates awaitingState={awaiting && placeholderKey === undefined}>
        {awaiting ? (
          // The awaiting-selection flavor with the view's own copy.
          <span className="text-muted-foreground text-sm">{placeholder}</span>
        ) : (
          <RichMessageEditor
            key={`${draftKey}#${resets[draftKey] ?? 0}`}
            defaultValue={draft}
            onChange={setDraft}
            placeholder={placeholder}
            ariaLabel={placeholder}
            disabled={!enabled || pending}
            onSubmit={() => void handleSubmit()}
            actions={
              <Row gap={2} className="justify-end">
                {undoText !== undefined && (
                  <Button variant="ghost" size="sm" onClick={handleUndo}>
                    {t('composer.undo')}
                  </Button>
                )}
                {improve && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!enabled || pending || draft.trim() === ''}
                    onClick={() => void handleImprove()}
                  >
                    {improve.labelKey
                      ? t(improve.labelKey, {
                          defaultValue: improve.label ?? t('composer.improve'),
                        })
                      : (improve.label ?? t('composer.improve'))}
                  </Button>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!canSend}
                  onClick={() => void handleSubmit()}
                >
                  {submitLabel}
                </Button>
              </Row>
            }
          />
        )}
      </BindingStates>
    </BlockFrame>
  );
}

type MessageComposerBlockProps = Partial<MessageComposerProps>;

/**
 * The registry entry for `registerConnectedBlock('MessageComposer', …)` —
 * wired into `registry/tale-config.tsx` by the registration site.
 */
export const messageComposerBlock: {
  fields: Fields;
  render: PuckComponent<MessageComposerBlockProps>;
} = {
  fields: { placeholderKey: { type: 'text' } },
  render: ({
    submit,
    improve,
    requiresState,
    placeholderKey,
    submitLabelKey,
    enabledWhen,
    onSuccess,
  }) =>
    submit ? (
      <MessageComposer
        submit={submit}
        improve={improve}
        requiresState={requiresState}
        placeholderKey={placeholderKey}
        submitLabelKey={submitLabelKey}
        enabledWhen={enabledWhen}
        onSuccess={onSuccess}
      />
    ) : (
      <></>
    ),
};
