import { cn } from '@tale/ui/cn';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { Brain, FileText, Globe, Package, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';

import { DemoShell } from './demo-shell';
import { DemoStreamText } from './demo-stream-text';
import { useDemoTimeline } from './use-demo-timeline';

const easeOut = [0.22, 1, 0.36, 1] as const;

const BEATS = [0, 300, 1600, 3000, 4200, 5400] as const;
const BEAT = {
  frame: 0,
  sources: 1,
  flow: 2,
  answer1: 3,
  answer2: 4,
  done: 5,
} as const;

const ENTRIES_FROM = 1247;
const ENTRIES_TO = 1250;

/**
 * D3 — sources pool into one governed knowledge base: documents, a crawled
 * website, and product data stream in, the entry counter ticks up, and an
 * answer cites what just landed.
 */
export function KnowledgePool() {
  const { t } = useT('home');
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-15%' });
  const beat = useDemoTimeline({ beats: BEATS, start: inView });
  const reduceMotion = useReducedMotion();

  const answerSegments = [
    t('demos.knowledge.answer1'),
    t('demos.knowledge.answer2'),
  ];
  const visible = Math.min(2, Math.max(0, beat - BEAT.flow));

  return (
    <div ref={ref}>
      <DemoShell
        label={t('demos.knowledge.label')}
        title={t('demos.knowledge.windowTitle')}
        className="mx-auto aspect-[7/10] max-w-4xl sm:aspect-[16/9]"
      >
        <div className="flex h-full flex-col gap-4 p-4 md:gap-5 md:p-6">
          <div className="grid flex-1 grid-cols-1 items-center gap-3 md:grid-cols-[1fr_auto_1fr] md:gap-0">
            <motion.div
              initial={reduceMotion ? false : 'hidden'}
              animate={beat >= BEAT.sources ? 'visible' : 'hidden'}
              variants={{
                hidden: {},
                visible: { transition: { staggerChildren: 0.14 } },
              }}
              className="flex flex-col gap-2.5"
            >
              <SourceCard
                icon={FileText}
                label={t('demos.knowledge.source1')}
                highlighted={beat >= BEAT.answer2}
                reduceMotion={reduceMotion ?? false}
              />
              <SourceCard
                icon={Globe}
                label={t('demos.knowledge.source2')}
                reduceMotion={reduceMotion ?? false}
              />
              <SourceCard
                icon={Package}
                label={t('demos.knowledge.source3')}
                reduceMotion={reduceMotion ?? false}
              />
            </motion.div>

            <div
              aria-hidden
              className="bg-border-base relative mx-auto h-4 w-px overflow-hidden md:mx-0 md:h-px md:w-10"
            >
              <div
                className={cn(
                  'bg-accent-base absolute inset-0 origin-top scale-y-0 transition-transform duration-700 md:origin-left md:scale-y-100 md:scale-x-0',
                  beat >= BEAT.flow && 'scale-y-100 md:scale-x-100',
                )}
              />
            </div>

            <div className="border-border-base bg-surface-site rounded-xl border p-4">
              <div className="flex items-center gap-2.5">
                <span className="border-border-base bg-surface-site-inset flex size-9 shrink-0 items-center justify-center rounded-lg border">
                  <Brain aria-hidden className="text-fg-muted size-4.5" />
                </span>
                <div>
                  <p className="text-fg-base text-sm font-medium">
                    {t('demos.knowledge.kbTitle')}
                  </p>
                  <p className="text-fg-subtle text-xs">
                    <CountUp
                      from={ENTRIES_FROM}
                      to={ENTRIES_TO}
                      play={beat >= BEAT.flow}
                      reduceMotion={reduceMotion ?? false}
                    />{' '}
                    {t('demos.knowledge.entriesLabel')}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="border-border-base bg-surface-site min-h-24 shrink-0 rounded-xl border px-4 py-3">
            {beat >= BEAT.answer1 ? (
              <>
                <DemoStreamText
                  segments={answerSegments}
                  visible={visible}
                  streaming={beat < BEAT.done && !reduceMotion}
                  className="text-fg-muted text-sm leading-relaxed"
                />
                {beat >= BEAT.answer2 ? (
                  <motion.span
                    initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease: easeOut }}
                    className="border-border-base bg-surface-site-inset text-fg-muted mt-2 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
                  >
                    <FileText aria-hidden className="size-3" />
                    <span className="text-fg-subtle">[1]</span>
                    {t('demos.knowledge.citation')}
                  </motion.span>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </DemoShell>
    </div>
  );
}

function SourceCard({
  icon: Icon,
  label,
  highlighted,
  reduceMotion,
}: {
  icon: LucideIcon;
  label: string;
  highlighted?: boolean;
  reduceMotion: boolean;
}) {
  return (
    <motion.div
      variants={{
        hidden: reduceMotion ? {} : { opacity: 0, x: -10 },
        visible: {
          opacity: 1,
          x: 0,
          transition: { duration: 0.4, ease: easeOut },
        },
      }}
      className={cn(
        'border-border-base bg-surface-site flex items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-all duration-300',
        highlighted && 'ring-accent-base/30 border-accent-base/40 ring-2',
      )}
    >
      <Icon aria-hidden className="text-fg-muted size-4 shrink-0" />
      <span className="text-fg-base min-w-0 truncate text-xs font-medium md:text-[13px]">
        {label}
      </span>
    </motion.div>
  );
}

function CountUp({
  from,
  to,
  play,
  reduceMotion,
}: {
  from: number;
  to: number;
  play: boolean;
  reduceMotion: boolean;
}) {
  const [value, setValue] = useState(() =>
    typeof window === 'undefined' ? to : from,
  );

  useEffect(() => {
    if (reduceMotion || (play && to - from <= 0)) {
      setValue(to);
      return undefined;
    }
    if (!play) return undefined;

    let raf = 0;
    const durationMs = 900;
    const origin = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - origin) / durationMs);
      setValue(Math.round(from + (to - from) * progress));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, play, reduceMotion, to]);

  return <span className="tabular-nums">{value.toLocaleString()}</span>;
}
