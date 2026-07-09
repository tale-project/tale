import { cn } from '@tale/ui/cn';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { Check, Workflow } from 'lucide-react';
import { useRef } from 'react';

import { useT } from '@/lib/i18n/client';

import { type GovernScenario, useGovernScenario } from './demo-scenarios';
import { DemoShell } from './demo-shell';
import { useDemoTimeline } from './use-demo-timeline';

const easeOut = [0.22, 1, 0.36, 1] as const;

const BEATS = [0, 400, 1800, 2500, 3200, 3900, 4600] as const;
const BEAT = {
  frame: 0,
  card: 1,
  pressed: 2,
  approved: 3,
  journal1: 4,
  journal2: 5,
  journal3: 6,
} as const;

const BUDGET_PERCENT = 41;

/**
 * D5 — in-chat approval card (ApprovalCard / WorkflowRunApprovalCard idiom)
 * with a short run journal — not a Settings governance split-panel.
 */
export function GovernGate({
  scenario,
}: {
  /** Story override — defaults to the homepage refund-approval scene. */
  scenario?: GovernScenario;
}) {
  const { t } = useT('home');
  const homeScenario = useGovernScenario();
  const scene = scenario ?? homeScenario;
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-15%' });
  const beat = useDemoTimeline({ beats: BEATS, start: inView });
  const reduceMotion = useReducedMotion();

  return (
    <div ref={ref}>
      <DemoShell
        label={scene.label}
        activeNav="chat"
        className="mx-auto aspect-[7/10] max-w-4xl sm:aspect-[16/9]"
      >
        <div className="flex h-full flex-col gap-4 p-4 md:gap-5 md:p-6">
          {beat >= BEAT.card ? (
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: easeOut }}
              className="border-border-base bg-surface-site-raised shadow-site-card mx-auto w-full max-w-md rounded-2xl border p-4 md:p-5"
            >
              <div className="flex items-start gap-3">
                <span className="bg-surface-site-inset text-fg-muted flex size-9 shrink-0 items-center justify-center rounded-lg">
                  <Workflow aria-hidden className="size-4" strokeWidth={1.75} />
                </span>
                <div className="min-w-0">
                  <p className="text-fg-base text-sm leading-snug font-medium">
                    {scene.approvalTitle}
                  </p>
                  <p className="text-fg-subtle mt-1 text-xs">
                    {scene.requester}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2">
                {beat >= BEAT.approved ? (
                  <motion.span
                    initial={reduceMotion ? false : { opacity: 0, scale: 0.94 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3, ease: easeOut }}
                    className="bg-accent-base text-accent-fg inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
                  >
                    <Check aria-hidden className="size-3.5" strokeWidth={2.5} />
                    {t('demos.govern.approved')}
                  </motion.span>
                ) : (
                  <>
                    <motion.span
                      animate={
                        beat === BEAT.pressed && !reduceMotion
                          ? { scale: 0.95 }
                          : { scale: 1 }
                      }
                      transition={{ duration: 0.15 }}
                      className="bg-accent-base text-accent-fg inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-medium"
                    >
                      {t('demos.govern.approve')}
                    </motion.span>
                    <span className="border-border-base text-fg-muted inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-medium">
                      {t('demos.govern.reject')}
                    </span>
                  </>
                )}
              </div>

              {beat >= BEAT.journal1 ? (
                <div className="border-border-base/70 mt-4 border-t pt-3">
                  <p className="text-fg-subtle mb-2 text-[10px] font-medium tracking-wide uppercase">
                    {t('demos.govern.auditTitle')}
                  </p>
                  <div className="flex flex-col gap-1.5">
                    <JournalLine
                      text={scene.journal[0]}
                      reduceMotion={reduceMotion ?? false}
                    />
                    {beat >= BEAT.journal2 ? (
                      <JournalLine
                        text={scene.journal[1]}
                        reduceMotion={reduceMotion ?? false}
                      />
                    ) : null}
                    {beat >= BEAT.journal3 ? (
                      <JournalLine
                        text={scene.journal[2]}
                        reduceMotion={reduceMotion ?? false}
                      />
                    ) : null}
                  </div>
                </div>
              ) : null}
            </motion.div>
          ) : null}

          <div className="border-border-base bg-surface-site-raised mt-auto rounded-xl border p-4">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-fg-subtle text-xs font-medium">
                {t('demos.govern.budgetLabel')}
              </p>
              <p className="text-fg-base text-xs font-medium tabular-nums">
                {scene.budgetValue}
              </p>
            </div>
            <div className="bg-surface-site-inset mt-2 h-1.5 overflow-hidden rounded-full">
              <div
                className={cn(
                  'bg-brand-base h-full origin-left rounded-full transition-transform duration-700 ease-out',
                  beat >= BEAT.approved ? 'scale-x-100' : 'scale-x-0',
                )}
                style={{ width: `${BUDGET_PERCENT}%` }}
              />
            </div>
          </div>
        </div>
      </DemoShell>
    </div>
  );
}

function JournalLine({
  text,
  reduceMotion,
}: {
  text: string;
  reduceMotion: boolean;
}) {
  return (
    <motion.p
      initial={reduceMotion ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: easeOut }}
      className="text-fg-muted flex items-center gap-2 text-xs"
    >
      <Check aria-hidden className="size-3 shrink-0" strokeWidth={2.5} />
      {text}
    </motion.p>
  );
}
