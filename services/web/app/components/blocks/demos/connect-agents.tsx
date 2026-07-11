import { cn } from '@tale/ui/cn';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { Bot } from 'lucide-react';
import { useRef } from 'react';

import { DemoToolbar } from '@/app/components/blocks/demos/demo-chrome';
import {
  type AgentsScenario,
  useAgentsScenario,
} from '@/app/components/blocks/demos/demo-scenarios';
import { DemoShell } from '@/app/components/blocks/demos/demo-shell';
import { useDemoTimeline } from '@/app/components/blocks/demos/use-demo-timeline';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;

const BEATS = [0, 250, 700, 1150, 1600, 2050, 2500] as const;
const BEAT = {
  frame: 0,
  row1: 1,
  done: 6,
} as const;

const COLS = '1.4fr 1fr 0.8fr';

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
        className="mx-auto aspect-[7/10] max-w-4xl sm:aspect-[16/10]"
      >
        <div className="flex h-full flex-col gap-3 p-3 md:gap-4 md:p-4">
          <DemoToolbar
            searchPlaceholder={t('demos.connect.searchPlaceholder')}
            addLabel={t('demos.connect.addLabel')}
          />

          <div className="border-border-base bg-surface-site-raised flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
            <div
              className="text-fg-subtle border-border-base grid gap-2 border-b px-3 py-2 text-[10px] font-medium tracking-wide uppercase md:px-4"
              style={{ gridTemplateColumns: COLS }}
            >
              <span>{t('demos.connect.colName')}</span>
              <span>{t('demos.connect.colModel')}</span>
              <span className="text-right">{t('demos.connect.colStatus')}</span>
            </div>
            <div className="flex flex-col">
              {scene.rows.map((row, index) =>
                beat >= BEAT.row1 + index ? (
                  <motion.div
                    key={row.name}
                    initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease: easeOut }}
                    className="border-border-base/60 grid items-center gap-2 border-b px-3 py-2.5 last:border-b-0 md:px-4"
                    style={{ gridTemplateColumns: COLS }}
                  >
                    <span className="text-fg-base flex min-w-0 items-center gap-2 text-xs font-medium md:text-[13px]">
                      <span className="bg-surface-site-inset text-fg-muted flex size-7 shrink-0 items-center justify-center rounded-md">
                        <Bot className="size-3.5" strokeWidth={1.75} />
                      </span>
                      <span className="truncate">{row.name}</span>
                    </span>
                    <span className="bg-surface-site-inset text-fg-muted inline-flex max-w-full truncate rounded-md px-1.5 py-0.5 text-[11px]">
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
                        {ready ? (
                          <span className="size-1.5 rounded-full bg-emerald-500" />
                        ) : null}
                        {t('demos.connect.statusReady')}
                      </span>
                    </span>
                  </motion.div>
                ) : null,
              )}
            </div>
          </div>
        </div>
      </DemoShell>
    </div>
  );
}
