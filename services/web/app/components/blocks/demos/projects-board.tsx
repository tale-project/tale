import { DemoToolbar } from '@tale/marketing-ui/demo-chrome';
import { DemoShell } from '@tale/marketing-ui/demo-shell';
import { useReducedMotion } from '@tale/marketing-ui/entrance';
import { useDemoTimeline } from '@tale/marketing-ui/use-demo-timeline';
import { cn } from '@tale/ui/cn';
import { motion, useInView } from 'framer-motion';
import { Bot, Folder, Users } from 'lucide-react';
import { useRef } from 'react';

import {
  type ProjectsScenario,
  useProjectsScenario,
} from '@/app/components/blocks/demos/demo-scenarios';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;

const BEATS = [0, 250, 700, 1150, 1600, 2050] as const;
const BEAT = {
  frame: 0,
  row1: 1,
  done: 5,
} as const;

const COLS = 'grid-cols-2 @lg/demo:grid-cols-[1.6fr_1fr_0.9fr]';

/**
 * D7 — Projects list. Shared DemoToolbar chrome.
 */
export function ProjectsBoard({
  scenario,
}: {
  /** Story override — defaults to the homepage workspace roster. */
  scenario?: ProjectsScenario;
}) {
  const { t } = useT('home');
  const homeScenario = useProjectsScenario();
  const scene = scenario ?? homeScenario;
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-15%' });
  const beat = useDemoTimeline({ beats: BEATS, start: inView });
  const reduceMotion = useReducedMotion();

  return (
    <div ref={ref}>
      <DemoShell
        label={scene.label}
        title={t('demos.projects.windowTitle')}
        activeNav="projects"
        className="mx-auto aspect-[7/10] min-h-144 max-w-4xl @lg/demo:aspect-[16/10] @lg/demo:min-h-120"
      >
        <div className="flex h-full flex-col gap-3 p-3 @2xl/demo:gap-4 @2xl/demo:p-4">
          <DemoToolbar
            searchPlaceholder={t('demos.projects.searchPlaceholder')}
            addLabel={t('demos.projects.newProject')}
          />

          <div className="border-border-base bg-surface-site-raised flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
            <div
              className={cn(
                'text-fg-subtle border-border-base grid gap-2 border-b px-3 py-2 text-[10px] font-medium tracking-wide uppercase @2xl/demo:px-4',
                COLS,
              )}
            >
              <span className="col-span-2 @lg/demo:col-span-1">
                {t('demos.projects.colName')}
              </span>
              <span>{t('demos.projects.colAgents')}</span>
              <span className="text-right">
                {t('demos.projects.colMembers')}
              </span>
            </div>
            <div className="flex flex-col">
              {scene.rows.map((row, index) =>
                beat >= BEAT.row1 + index ? (
                  <motion.div
                    key={row.name}
                    initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease: easeOut }}
                    className={cn(
                      'border-border-base/60 grid items-center gap-2 border-b px-3 py-2.5 last:border-b-0 @2xl/demo:px-4',
                      COLS,
                      beat >= BEAT.done && index === 0
                        ? 'bg-surface-site-inset/50'
                        : '',
                    )}
                  >
                    <span className="text-fg-base col-span-2 flex min-w-0 items-center gap-2 text-xs font-medium @lg/demo:col-span-1 @2xl/demo:text-[13px]">
                      <span className="bg-surface-site-inset text-fg-muted flex size-7 shrink-0 items-center justify-center rounded-md">
                        <Folder className="size-3.5" strokeWidth={1.75} />
                      </span>
                      <span className="wrap-break-word">{row.name}</span>
                    </span>
                    <span className="text-fg-muted flex min-w-0 items-center gap-1.5 text-xs">
                      <Bot className="size-3.5 shrink-0" strokeWidth={1.75} />
                      <span>{row.agents}</span>
                    </span>
                    <span className="text-fg-muted flex items-center justify-end gap-1 text-xs">
                      <Users className="size-3.5" strokeWidth={1.75} />
                      {row.members}
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
