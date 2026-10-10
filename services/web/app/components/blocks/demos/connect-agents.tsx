import { DemoToolbar } from '@tale/marketing-ui/demo-chrome';
import { DemoShell } from '@tale/marketing-ui/demo-shell';
import { useReducedMotion } from '@tale/marketing-ui/entrance';
import { useDemoTimeline } from '@tale/marketing-ui/use-demo-timeline';
import { cn } from '@tale/ui/cn';
import { cva } from 'class-variance-authority';
import { motion, useInView } from 'framer-motion';
import { Bot } from 'lucide-react';
import { useRef } from 'react';

import {
  type AgentsScenario,
  useAgentsScenario,
} from '@/app/components/blocks/demos/demo-scenarios';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;

const BEATS = [0, 250, 700, 1150, 1600, 2050, 2500] as const;
const BEAT = {
  frame: 0,
  row1: 1,
  done: 6,
} as const;

const agentMark = cva(
  'flex size-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-current/10',
  {
    variants: {
      color: {
        0: 'bg-demo-coral-soft text-demo-coral',
        1: 'bg-demo-violet-soft text-demo-violet',
        2: 'bg-demo-sky-soft text-demo-sky',
        3: 'bg-demo-mint-soft text-demo-mint',
        4: 'bg-demo-gold-soft text-demo-gold',
      },
    },
  },
);

/**
 * D2 — Agents list. Toolbar + table chrome from demo-chrome.
 */
export function ConnectAgents({
  scenario,
}: {
  /** Story override — defaults to the homepage agents roster. */
  scenario?: AgentsScenario;
}) {
  const { t } = useT('home');
  const homeScenario = useAgentsScenario();
  const scene = scenario ?? homeScenario;
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-15%' });
  const beat = useDemoTimeline({ beats: BEATS, start: inView });
  const reduceMotion = useReducedMotion();
  const ready = beat >= BEAT.done;

  return (
    <div ref={ref}>
      <DemoShell
        label={scene.label}
        title={t('demos.connect.windowTitle')}
        activeNav="agents"
        className="mx-auto min-h-160 max-w-4xl @sm/demo:min-h-144 @2xl/demo:aspect-[16/10] @2xl/demo:min-h-120"
      >
        <div className="demo-surface flex h-full flex-col gap-3 p-3 @2xl/demo:gap-4 @2xl/demo:p-4">
          <DemoToolbar
            searchPlaceholder={t('demos.connect.searchPlaceholder')}
            addLabel={t('demos.connect.addLabel')}
          />

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="text-fg-subtle hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_5rem] gap-2 px-3 py-2 text-[10px] font-medium tracking-wide uppercase @2xl/demo:grid @2xl/demo:px-4">
              <span>{t('demos.connect.colName')}</span>
              <span>{t('demos.connect.colModel')}</span>
              <span className="text-right">{t('demos.connect.colStatus')}</span>
            </div>
            <div className="flex flex-col gap-2">
              {scene.rows.map((row, index) => (
                <motion.div
                  key={row.name}
                  data-agent-row=""
                  initial={false}
                  animate={{ opacity: beat >= BEAT.row1 + index ? 1 : 0 }}
                  transition={{
                    duration: reduceMotion ? 0 : 0.3,
                    ease: easeOut,
                  }}
                  className="border-border-base/70 bg-surface-site-raised grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded-xl border px-2.5 py-2.5 shadow-sm @2xl/demo:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_5rem] @2xl/demo:px-4"
                >
                  <span className="text-fg-base col-span-2 flex min-w-0 items-center gap-2 text-xs font-medium @2xl/demo:col-span-1 @2xl/demo:text-[13px]">
                    <span
                      className={agentMark({
                        color: (index % 5) as 0 | 1 | 2 | 3 | 4,
                      })}
                    >
                      <Bot className="size-3.5" strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0 wrap-anywhere">{row.name}</span>
                  </span>
                  <span className="text-fg-muted ml-9 min-w-0 text-[10px] wrap-anywhere @2xl/demo:ml-0 @2xl/demo:text-[11px]">
                    {row.model}
                  </span>
                  <span className="flex justify-end">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium',
                        ready
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                          : 'bg-surface-site-inset text-fg-muted',
                      )}
                    >
                      <span
                        className={cn(
                          'size-1.5 shrink-0 rounded-full bg-emerald-500',
                          !ready && 'opacity-0',
                        )}
                      />
                      {t('demos.connect.statusReady')}
                    </span>
                  </span>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </DemoShell>
    </div>
  );
}
