'use client';

import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { WizardStep } from '@tale/ui/wizard/wizard';
import { Bot, Check, KeyRound, Users } from 'lucide-react';
import { type ReactNode, type RefObject, useRef, useState } from 'react';

import { ConnectAgentDialog } from '@/app/features/coding-agent/components/connect-agent-dialog';
import {
  useAgentConnectionAccess,
  useAgentConnections,
} from '@/app/features/settings/agent-connections/hooks/queries';
import { useT } from '@/lib/i18n/client';

/** Where a finish-step CTA sends the user (after marking onboarding complete). */
export type FinishTarget = 'providers' | 'members';

interface FinishStepProps {
  /**
   * Completes onboarding, then routes to the chosen destination. Provided by
   * the wizard so the CTAs and the footer's "Go to Home" share the same
   * mark-complete logic. When absent (e.g. a story), CTAs render disabled.
   */
  onFinishTo?: (target: FinishTarget) => void;
  /**
   * When true, the "connect a provider" row renders as already-done (a check,
   * not a CTA) — the user connected one during onboarding, so listing it as a
   * pending next step would be confusing.
   */
  providerConnected?: boolean;
  /**
   * The workspace the wizard has just made. With it, a row offers to connect a
   * coding agent to that workspace; without it (a story), there is no row.
   */
  organizationId?: string | null;
}

/**
 * Closing step: instead of a static checklist, each "what's next" item is an
 * actionable CTA that marks onboarding complete and lands the user exactly
 * where the task gets done — so a fresh workspace never dead-ends on "now
 * what?". An item the user already finished (e.g. a connected AI provider)
 * renders as done instead of a redundant CTA. The footer's "Go to Home"
 * remains the skip-everything exit.
 *
 * Connecting a coding agent is the one item that does not leave: its guided
 * setup opens in place, so the wizard is still here when the agent has signed
 * in and the row turns to done.
 */
export function FinishStep({
  onFinishTo,
  providerConnected,
  organizationId,
}: FinishStepProps) {
  const { t } = useT('onboarding');

  const items: {
    target: FinishTarget;
    icon: typeof KeyRound;
    text: string;
    cta: string;
    done: boolean;
    doneText: string;
  }[] = [
    {
      target: 'providers',
      icon: KeyRound,
      text: t('finish.providerItem'),
      cta: t('finish.providerCta'),
      done: Boolean(providerConnected),
      doneText: t('finish.providerConnected'),
    },
    {
      target: 'members',
      icon: Users,
      text: t('finish.inviteItem'),
      cta: t('finish.inviteCta'),
      done: false,
      doneText: '',
    },
  ];

  return (
    <WizardStep id="finish">
      {/* Heading + subtitle live in the wizard hero now. One bordered panel
          with divided rows (not three separate cards) reads as a single
          "what's next" list; each row leads with an icon chip. */}
      <ul
        role="list"
        className="divide-border border-border divide-y overflow-hidden rounded-lg border"
      >
        {items.map(({ target, icon, text, cta, done, doneText }) => (
          <NextStepRow
            key={target}
            icon={icon}
            text={text}
            done={done}
            doneText={doneText}
            action={
              <Button
                type="button"
                variant="secondary"
                disabled={!onFinishTo}
                onClick={() => onFinishTo?.(target)}
              >
                {cta}
              </Button>
            }
          />
        ))}
        {organizationId ? (
          <CodingAgentRow organizationId={organizationId} />
        ) : null}
      </ul>
    </WizardStep>
  );
}

/** One "what's next" row: an icon chip, the sentence, and the way to do it —
 * or a check and what was done. */
function NextStepRow({
  icon: Icon,
  text,
  done,
  doneText,
  action,
  rowRef,
}: {
  icon: typeof KeyRound;
  text: string;
  done: boolean;
  doneText: string;
  action: ReactNode;
  /** Makes the row a place focus can be sent to: where a dialog opened from
   * its button returns when the button has turned into the done marker. */
  rowRef?: RefObject<HTMLLIElement | null>;
}) {
  return (
    <li
      ref={rowRef}
      {...(rowRef && { tabIndex: -1 })}
      className="focus-visible:ring-ring flex flex-wrap items-center gap-x-3 gap-y-2 p-3 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
    >
      {/* The sentence takes what the button leaves; on a phone, where a
          long word and a long label do not fit side by side, the button
          wraps under it instead of leaving the list. */}
      <span className="flex flex-1 basis-40 items-center gap-3">
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-lg',
            done
              ? 'bg-success/10 text-success'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {done ? (
            <Check className="size-4" aria-hidden />
          ) : (
            <Icon className="size-4" aria-hidden />
          )}
        </span>
        <span className={cn('text-sm', done && 'text-muted-foreground')}>
          {done ? doneText : text}
        </span>
      </span>
      {done ? null : <span className="ml-auto flex shrink-0">{action}</span>}
    </li>
  );
}

/**
 * Connecting a coding agent to the new workspace. The row appears once the
 * deployment is known to let agents sign in and this person may connect one —
 * a promise it cannot keep is not made — and turns to done when an agent is
 * connected, as the dialog's own watch sees it.
 */
function CodingAgentRow({ organizationId }: { organizationId: string }) {
  const { t } = useT('onboarding');
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLLIElement>(null);
  const access = useAgentConnectionAccess(organizationId);
  const mine = useAgentConnections(organizationId, {
    scope: 'mine',
    ended: false,
  });
  const connected = mine.data?.connections[0];
  if (connected === undefined && access.data?.mayConnect !== true) return null;
  return (
    <>
      <NextStepRow
        icon={Bot}
        text={t('finish.agentItem')}
        done={connected !== undefined}
        doneText={t('finish.agentConnected', {
          client: connected?.clientName ?? '',
        })}
        rowRef={rowRef}
        action={
          <Button
            type="button"
            variant="secondary"
            aria-haspopup="dialog"
            onClick={() => setOpen(true)}
          >
            {t('finish.agentCta')}
          </Button>
        }
      />
      <ConnectAgentDialog
        organizationId={organizationId}
        open={open}
        onOpenChange={setOpen}
        restoreFocusRef={rowRef}
      />
    </>
  );
}
