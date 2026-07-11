import { cn } from '@tale/ui/cn';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import {
  BookOpen,
  FileText,
  Globe,
  Package,
  type LucideIcon,
} from 'lucide-react';
import { useRef } from 'react';

import { DemoToolbar } from '@/app/components/blocks/demos/demo-chrome';
import {
  type KnowledgeRowType,
  type KnowledgeScenario,
  useKnowledgeScenario,
} from '@/app/components/blocks/demos/demo-scenarios';
import { DemoShell } from '@/app/components/blocks/demos/demo-shell';
import { useDemoTimeline } from '@/app/components/blocks/demos/use-demo-timeline';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;

const BEATS = [0, 250, 900, 1550, 2200, 2850, 3500] as const;
const BEAT = {
  frame: 0,
  row1: 1,
  indexing: 5,
  done: 6,
} as const;

/* Row-type icons mirror the product: FileText documents, Globe crawls,
   Package catalog records, BookOpen knowledge entries
   (services/platform/app/features/knowledge-entries columns). */
const TYPE_ICON: Record<KnowledgeRowType, LucideIcon> = {
  pdf: FileText,
  website: Globe,
  catalog: Package,
  entry: BookOpen,
};

const TYPE_LABEL_KEY: Record<KnowledgeRowType, string> = {
  pdf: 'demos.knowledge.typePdf',
  website: 'demos.knowledge.typeWebsite',
  catalog: 'demos.knowledge.typeCatalog',
  entry: 'demos.knowledge.typeEntry',
};

const COLS = '1.6fr 0.9fr 0.9fr';

/**
 * D3 — Knowledge documents table. Shared DemoToolbar chrome.
 */
export function KnowledgePool({
  scenario,
}: {
  /** Story override — defaults to the homepage support library. */
  scenario?: KnowledgeScenario;
}) {
  const { t } = useT('home');
  const homeScenario = useKnowledgeScenario();
  const scene = scenario ?? homeScenario;
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-15%' });
  const beat = useDemoTimeline({ beats: BEATS, start: inView });
  const reduceMotion = useReducedMotion();

  return (
    <div ref={ref}>
      <DemoShell
        label={scene.label}
        title={t('demos.knowledge.windowTitle')}
        activeNav="knowledge"
        className="mx-auto aspect-[7/10] max-w-4xl sm:aspect-[16/10]"
      >
        <div className="flex h-full flex-col gap-3 p-3 md:gap-4 md:p-4">
          <DemoToolbar
            searchPlaceholder={t('demos.knowledge.searchPlaceholder')}
            addLabel={t('demos.knowledge.addLabel')}
          />

          <div className="border-border-base bg-surface-site-raised flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
            <div
              className="text-fg-subtle border-border-base grid gap-2 border-b px-3 py-2 text-[10px] font-medium tracking-wide uppercase md:px-4"
              style={{ gridTemplateColumns: COLS }}
            >
              <span>{t('demos.knowledge.colName')}</span>
              <span>{t('demos.knowledge.colType')}</span>
              <span className="text-right">
                {t('demos.knowledge.colStatus')}
              </span>
            </div>
            <div className="flex flex-col">
              {scene.rows.map((row, index) => {
                const Icon = TYPE_ICON[row.type];
                const indexed = beat >= BEAT.done;
                const indexing = beat >= BEAT.indexing && !indexed;
                return beat >= BEAT.row1 + index ? (
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
                        <Icon
                          aria-hidden
                          className="size-3.5"
                          strokeWidth={1.75}
                        />
                      </span>
                      <span className="truncate">{row.name}</span>
                    </span>
                    <span className="text-fg-muted truncate text-xs">
                      {t(TYPE_LABEL_KEY[row.type])}
                    </span>
                    <span className="flex justify-end">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium',
                          indexed
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                            : indexing
                              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                              : 'bg-surface-site-inset text-fg-muted',
                        )}
                      >
                        {indexed
                          ? t('demos.knowledge.statusIndexed')
                          : t('demos.knowledge.statusIndexing')}
                      </span>
                    </span>
                  </motion.div>
                ) : null;
              })}
            </div>
          </div>
        </div>
      </DemoShell>
    </div>
  );
}
