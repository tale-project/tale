import { cn } from '@tale/ui/cn';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { Bot, ChevronDown, Cpu } from 'lucide-react';
import { useRef } from 'react';

import { useT } from '@/lib/i18n/client';

import { type ArenaScenario, useArenaScenario } from './demo-scenarios';
import { DemoShell } from './demo-shell';
import { DemoStreamText } from './demo-stream-text';
import { useDemoTimeline } from './use-demo-timeline';

const easeOut = [0.22, 1, 0.36, 1] as const;

const BEATS = [0, 350, 1000, 1600, 2200, 2800, 3400] as const;
const BEAT = {
  frame: 0,
  prompt: 1,
  paneA: 2,
  paneB: 3,
  streamA: 4,
  streamB: 5,
  streamDone: 6,
} as const;

/**
 * D6 — Chat Arena split view. Mirrors chat-arena-split.webp /
 * arena-model-selector.tsx: one prompt, two model panes side by side.
 */
export function ChatArena({
  scenario,
}: {
  /** Story override — defaults to the homepage reply-drafting duel. */
  scenario?: ArenaScenario;
}) {
  const { t } = useT('home');
  const homeScenario = useArenaScenario();
  const scene = scenario ?? homeScenario;
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-15%' });
  const beat = useDemoTimeline({ beats: BEATS, start: inView });
  const reduceMotion = useReducedMotion();

  const replyA = scene.repliesA;
  const replyB = scene.repliesB;
  const visibleA =
    beat >= BEAT.streamDone
      ? 3
      : beat >= BEAT.streamB
        ? 2
        : beat >= BEAT.streamA
          ? 1
          : 0;
  const visibleB = beat >= BEAT.streamDone ? 3 : beat >= BEAT.streamB ? 2 : 0;

  return (
    <div ref={ref}>
      <DemoShell
        label={scene.label}
        activeNav="chat"
        className="mx-auto aspect-[7/10] max-w-4xl sm:aspect-[16/9]"
      >
        <div className="flex h-full flex-col">
          {beat >= BEAT.prompt ? (
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: easeOut }}
              className="border-border-base/70 shrink-0 border-b px-3 py-2.5 md:px-4"
            >
              <div className="bg-surface-site-inset text-fg-base ml-auto max-w-[85%] rounded-2xl px-3 py-2 text-xs md:text-sm">
                {scene.prompt}
              </div>
            </motion.div>
          ) : null}

          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden sm:grid-cols-2">
            <ArenaPane
              show={beat >= BEAT.paneA}
              model={scene.modelA}
              agent={scene.agent}
              segments={replyA}
              visible={visibleA}
              streaming={beat < BEAT.streamDone && !reduceMotion}
              border
            />
            <ArenaPane
              show={beat >= BEAT.paneB}
              model={scene.modelB}
              agent={scene.agent}
              segments={replyB}
              visible={visibleB}
              streaming={beat < BEAT.streamDone && !reduceMotion}
            />
          </div>

          <div className="border-border-base/70 text-fg-muted flex shrink-0 items-center justify-center gap-2 border-t px-3 py-2 text-[11px] font-medium">
            <span className="inline-flex items-center gap-1">
              <Cpu className="size-3" strokeWidth={1.75} />
              {scene.modelA}
            </span>
            <span className="text-fg-subtle">{t('demos.arena.vs')}</span>
            <span className="inline-flex items-center gap-1">
              <Cpu className="size-3" strokeWidth={1.75} />
              {scene.modelB}
            </span>
          </div>
        </div>
      </DemoShell>
    </div>
  );
}

function ArenaPane({
  show,
  model,
  agent,
  segments,
  visible,
  streaming,
  border,
}: {
  show: boolean;
  model: string;
  agent: string;
  segments: readonly string[];
  visible: number;
  streaming: boolean;
  border?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  if (!show) {
    return (
      <div className={cn(border && 'border-border-base/70 sm:border-r')} />
    );
  }

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35, ease: easeOut }}
      className={cn(
        'flex min-h-0 flex-col overflow-hidden p-3 md:p-4',
        border && 'border-border-base/70 sm:border-r',
      )}
    >
      <div className="text-fg-muted mb-2 flex shrink-0 items-center gap-1.5 text-[11px] font-medium">
        <Bot className="size-3.5" strokeWidth={1.75} />
        <span className="truncate">{agent}</span>
        <ChevronDown className="size-3 opacity-70" />
        <span className="text-fg-subtle">·</span>
        <span className="truncate">{model}</span>
      </div>
      {visible > 0 ? (
        <DemoStreamText
          segments={segments}
          visible={visible}
          streaming={streaming}
          className="text-fg-base text-xs leading-relaxed md:text-[13px]"
        />
      ) : null}
    </motion.div>
  );
}
