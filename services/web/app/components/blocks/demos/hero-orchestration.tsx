import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowUp,
  Bookmark,
  Bot,
  Brain,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  FileText,
  GitFork,
  Mic,
  MoreHorizontal,
  Plus,
  ThumbsDown,
  ThumbsUp,
  Waypoints,
} from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import { type ChatScenario, useChatScenario } from './demo-scenarios';
import { DemoShell } from './demo-shell';
import { DemoStreamText } from './demo-stream-text';
import { DemoTypingText } from './demo-typing-text';
import { useDemoTimeline } from './use-demo-timeline';

const easeOut = [0.22, 1, 0.36, 1] as const;

/**
 * Thread layout inside the hero DemoShell. Grows downward so new messages
 * never shift prior bubbles (CLS). Do not switch back to `justify-end`.
 */
export const HERO_THREAD_CLASS =
  'flex min-h-0 flex-1 flex-col justify-start gap-2.5 px-3 py-3 sm:gap-3 sm:px-5 sm:py-4';

// Compact beat script — end state must fit the frame with no inner scroll.
const BEATS = [0, 250, 1200, 1600, 2100, 2700, 3300, 3900, 4500] as const;
const BEAT = {
  frame: 0,
  typing: 1,
  sent: 2,
  routing: 3,
  thought: 4,
  clause1: 5,
  clause2: 6,
  clause3: 7,
  status: 8,
} as const;

/**
 * D1 — hero chat. Mirrors product message-bubble.tsx + chat-input.tsx:
 * - User: right-aligned muted bubble (`bg-muted` → surface-site-inset)
 * - Assistant: full-width plain text on the page surface (not a white card)
 * - Citations: muted source cards
 * - Composer: bordered card with toolbar
 * Layout is fixed — no overflow scroll inside the shell.
 */
export function HeroOrchestration({
  scenario,
  elevation = 'hero',
}: {
  /** Story override — defaults to the homepage support-escalation scene. */
  scenario?: ChatScenario;
  elevation?: 'default' | 'hero';
}) {
  const { t } = useT('home');
  const homeScenario = useChatScenario();
  const scene = scenario ?? homeScenario;
  const beat = useDemoTimeline({ beats: BEATS, start: true });
  const reduceMotion = useReducedMotion();

  const replySegments = scene.replies;
  const visibleClauses = Math.min(4, Math.max(0, beat - BEAT.thought));
  const pop = (delay = 0) => ({
    initial: reduceMotion ? false : { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.3, ease: easeOut, delay },
  });

  return (
    <DemoShell
      label={scene.label}
      activeNav="chat"
      elevation={elevation}
      className="mx-auto aspect-[3/4] max-w-4xl sm:aspect-[16/10]"
    >
      <div className="flex h-full flex-col">
        {/* Thread grows downward (`justify-start`) so new beats never push
            prior bubbles up — `justify-end` was the CLS source on agents. */}
        <div className={HERO_THREAD_CLASS}>
          {beat >= BEAT.sent ? (
            <motion.div {...pop()} className="flex flex-col items-end">
              <div className="bg-surface-site-inset text-fg-base max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm sm:max-w-md">
                {scene.prompt}
              </div>
            </motion.div>
          ) : null}

          {beat >= BEAT.routing ? (
            <motion.div {...pop()} className="flex flex-col items-start">
              <p className="text-fg-subtle mb-1.5 flex items-start gap-1.5 text-[11px] sm:text-xs">
                <Waypoints
                  aria-hidden
                  className="mt-0.5 size-3.5 shrink-0"
                  strokeWidth={1.75}
                />
                <span>
                  <span className="text-fg-base font-medium">
                    {scene.routedTitle}
                  </span>
                  <span className="text-fg-muted"> {scene.routedDetail}</span>
                </span>
              </p>

              {beat >= BEAT.thought ? (
                <p className="text-fg-subtle mb-1.5 flex items-center gap-1.5 text-[11px] sm:text-xs">
                  <ChevronRight aria-hidden className="size-3" />
                  <Brain aria-hidden className="size-3.5" strokeWidth={1.75} />
                  {t('demos.hero.thought')}
                </p>
              ) : null}

              {beat >= BEAT.clause1 ? (
                <div className="text-fg-base w-full min-w-0">
                  <DemoStreamText
                    segments={replySegments}
                    visible={visibleClauses}
                    streaming={beat < BEAT.status && !reduceMotion}
                    className="text-fg-base text-sm leading-relaxed"
                  />
                </div>
              ) : null}

              <div className="mt-2 flex flex-wrap gap-1.5">
                {beat >= BEAT.clause2 ? (
                  <SourceCard label={scene.citations[0]} />
                ) : null}
                {beat >= BEAT.clause3 ? (
                  <SourceCard label={scene.citations[1]} />
                ) : null}
              </div>

              {beat >= BEAT.status ? (
                <motion.div {...pop(0.05)} className="mt-2">
                  <span className="text-fg-subtle flex items-center gap-2.5">
                    <Copy className="size-3.5" strokeWidth={1.75} />
                    <ThumbsUp className="size-3.5" strokeWidth={1.75} />
                    <ThumbsDown className="size-3.5" strokeWidth={1.75} />
                    <GitFork className="size-3.5" strokeWidth={1.75} />
                    <MoreHorizontal className="size-3.5" strokeWidth={1.75} />
                  </span>
                </motion.div>
              ) : null}
            </motion.div>
          ) : null}
        </div>

        {/* Composer — chat-input.tsx card chrome. */}
        <div className="shrink-0 px-3 pb-2.5 sm:px-4 sm:pb-3">
          <div className="border-border-base relative flex flex-col rounded-xl border px-3 pt-2.5 shadow-[0_-6px_16px_-8px_color-mix(in_oklab,var(--color-fg-base)_12%,transparent)] sm:rounded-2xl sm:px-4 sm:pt-3">
            <span className="text-fg-subtle min-h-7 text-sm sm:min-h-8">
              {beat < BEAT.sent ? (
                <DemoTypingText
                  text={scene.prompt}
                  play={beat >= BEAT.typing}
                  done={beat >= BEAT.sent}
                />
              ) : (
                t('demos.hero.inputPlaceholder')
              )}
            </span>
            <div className="flex items-center justify-between gap-2 pb-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <Plus aria-hidden className="text-fg-subtle size-4 shrink-0" />
                <Bookmark
                  aria-hidden
                  className="text-fg-subtle size-3.5 shrink-0"
                />
                <span className="text-fg-muted ml-0.5 inline-flex items-center gap-1 text-xs font-medium">
                  <Bot aria-hidden className="size-3.5" />
                  <span className="max-w-24 truncate sm:max-w-none">
                    {beat >= BEAT.routing
                      ? scene.agentRouted
                      : t('demos.hero.composerAgent')}
                  </span>
                  <ChevronDown aria-hidden className="size-3 opacity-70" />
                </span>
                <span className="text-fg-muted hidden items-center gap-1 text-xs font-medium sm:inline-flex">
                  <Cpu aria-hidden className="size-3.5" />
                  {scene.model}
                  <ChevronDown aria-hidden className="size-3 opacity-70" />
                </span>
              </div>
              <span className="flex shrink-0 items-center gap-2">
                <Mic aria-hidden className="text-fg-subtle size-4" />
                <span className="bg-accent-base text-accent-fg flex size-7 items-center justify-center rounded-full">
                  <ArrowUp aria-hidden className="size-3.5" />
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </DemoShell>
  );
}

function SourceCard({ label }: { label: string }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.span
      initial={reduceMotion ? false : { opacity: 0, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: easeOut }}
      className="border-border-base bg-surface-site-inset/60 text-fg-base inline-flex max-w-[200px] items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs"
    >
      <FileText
        aria-hidden
        className="text-fg-muted size-3.5 shrink-0"
        strokeWidth={1.75}
      />
      <span className="truncate font-medium">{label}</span>
    </motion.span>
  );
}
