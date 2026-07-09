import { cn } from '@tale/ui/cn';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { Bot, Check, ShieldCheck } from 'lucide-react';
import { useRef } from 'react';

import { useT } from '@/lib/i18n/client';

import { DemoShell } from './demo-shell';
import { useDemoTimeline } from './use-demo-timeline';

const easeOut = [0.22, 1, 0.36, 1] as const;

const BEATS = [0, 400, 2000, 2800, 3600, 4200, 4800, 6000] as const;
const BEAT = {
  frame: 0,
  card: 1,
  pressed: 2,
  approved: 3,
  audit1: 4,
  audit2: 5,
  audit3: 6,
  stats: 7,
} as const;

const BUDGET_PERCENT = 41;

/**
 * D5 — governance in one moment: an automation asks permission, a human
 * approves, the audit log records it, and budget/usage stay in view.
 */
export function GovernGate() {
  const { t } = useT('home');
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-15%' });
  const beat = useDemoTimeline({ beats: BEATS, start: inView });
  const reduceMotion = useReducedMotion();

  const auditKeys = ['audit1', 'audit2', 'audit3'] as const;
  const auditBeats = [BEAT.audit1, BEAT.audit2, BEAT.audit3];

  return (
    <div ref={ref}>
      <DemoShell
        label={t('demos.govern.label')}
        title={t('demos.govern.windowTitle')}
        className="mx-auto aspect-[7/10] max-w-4xl sm:aspect-[16/9]"
      >
        <div className="grid h-full grid-cols-1 gap-4 p-4 md:grid-cols-2 md:gap-5 md:p-6">
          <div className="flex flex-col gap-4">
            {beat >= BEAT.card ? (
              <motion.div
                initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: easeOut }}
                className="border-border-base bg-surface-site rounded-xl border p-4"
              >
                <div className="flex items-start gap-2.5">
                  <span className="border-border-base bg-surface-site-inset flex size-8 shrink-0 items-center justify-center rounded-lg border">
                    <ShieldCheck aria-hidden className="text-fg-muted size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-fg-base text-sm font-medium">
                      {t('demos.govern.approvalTitle')}
                    </p>
                    <p className="text-fg-subtle mt-1 inline-flex items-center gap-1.5 text-xs">
                      <Bot aria-hidden className="size-3.5" />
                      {t('demos.govern.requester')}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  {beat >= BEAT.approved ? (
                    <motion.span
                      initial={
                        reduceMotion ? false : { opacity: 0, scale: 0.94 }
                      }
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.3, ease: easeOut }}
                      className="bg-accent-base text-accent-fg inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
                    >
                      <Check
                        aria-hidden
                        className="size-3.5"
                        strokeWidth={2.5}
                      />
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
              </motion.div>
            ) : null}

            <div className="border-border-base bg-surface-site mt-auto rounded-xl border p-4">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-fg-subtle text-xs font-medium tracking-wide uppercase">
                  {t('demos.govern.budgetLabel')}
                </p>
                <p className="text-fg-base text-xs font-medium tabular-nums">
                  {t('demos.govern.budgetValue')}
                </p>
              </div>
              <div className="bg-surface-site-inset mt-2 h-1.5 overflow-hidden rounded-full">
                <div
                  className={cn(
                    'bg-accent-base h-full origin-left rounded-full transition-transform duration-700 ease-out',
                    beat >= BEAT.stats ? 'scale-x-100' : 'scale-x-0',
                  )}
                  style={{ width: `${BUDGET_PERCENT}%` }}
                />
              </div>
              <p className="text-fg-subtle mt-2 text-xs">
                {t('demos.govern.runsLabel')}
              </p>
            </div>
          </div>

          <div className="border-border-base bg-surface-site flex min-h-0 flex-col rounded-xl border">
            <p className="text-fg-subtle border-border-base border-b px-4 py-2 text-xs font-medium tracking-wide uppercase">
              {t('demos.govern.auditTitle')}
            </p>
            <div className="flex flex-col px-4 py-1">
              {auditKeys.map((key, i) =>
                beat >= auditBeats[i] ? (
                  <motion.p
                    key={key}
                    initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, ease: easeOut }}
                    className="text-fg-muted border-border-base flex items-center gap-2 border-b py-2.5 text-xs last:border-b-0"
                  >
                    <Check
                      aria-hidden
                      className="size-3 shrink-0"
                      strokeWidth={2.5}
                    />
                    {t(`demos.govern.${key}`)}
                  </motion.p>
                ) : null,
              )}
            </div>
          </div>
        </div>
      </DemoShell>
    </div>
  );
}
