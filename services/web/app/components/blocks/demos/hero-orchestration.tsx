import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowUp,
  Bookmark,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Mic,
  Plus,
  Sparkles,
} from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import { DemoShell } from './demo-shell';
import { DemoStreamText } from './demo-stream-text';
import { DemoTypingText } from './demo-typing-text';
import { useDemoTimeline } from './use-demo-timeline';

const easeOut = [0.22, 1, 0.36, 1] as const;

// Beat script (ms offsets). The final beat is the complete end state the
// prerenderer and reduced-motion users see. Plays once on mount — no loop.
const BEATS = [0, 400, 2600, 3400, 4300, 5200, 6100, 7500] as const;
const BEAT = {
  frame: 0,
  typing: 1,
  sent: 2,
  clause1: 3,
  clause2: 4,
  clause3: 5,
  clause4: 6,
  status: 7,
} as const;

/**
 * D1 — the hero orchestration moment: a task is typed, Tale's Auto picker
 * routes it to an agent + model, and the reply streams in grounded in cited
 * sources. Pure DOM + tokens; product vocabulary ("Auto", agent · model)
 * mirrors the platform's chat surface.
 */
export function HeroOrchestration() {
  const { t } = useT('home');
  const beat = useDemoTimeline({ beats: BEATS, start: true });
  const reduceMotion = useReducedMotion();

  const replySegments = [
    t('demos.hero.reply1'),
    t('demos.hero.reply2'),
    t('demos.hero.reply3'),
    t('demos.hero.reply4'),
  ];
  const visibleClauses = Math.min(4, Math.max(0, beat - BEAT.sent));
  const pop = (delay = 0) => ({
    initial: reduceMotion ? false : { opacity: 0, y: 6, scale: 0.97 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: { duration: 0.35, ease: easeOut, delay },
  });

  return (
    <DemoShell
      label={t('demos.hero.label')}
      title={t('demos.hero.windowTitle')}
      activeNav="chat"
      className="mx-auto aspect-[7/10] max-w-4xl sm:aspect-[16/9]"
    >
      <div className="flex h-full flex-col gap-4 p-4 text-left md:gap-5 md:p-6">
        <div className="flex justify-end">
          <div className="bg-surface-site-inset text-fg-base max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-sm md:text-[15px]">
            <DemoTypingText
              text={t('demos.hero.prompt')}
              play={beat >= BEAT.typing}
              done={beat >= BEAT.sent}
            />
          </div>
        </div>

        {beat >= BEAT.sent ? (
          <motion.div {...pop()} className="flex">
            <span className="border-border-base bg-surface-site text-fg-muted inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs">
              <Sparkles aria-hidden className="size-3" />
              {t('demos.hero.chipAuto')}
              <span aria-hidden className="text-fg-subtle">
                →
              </span>
              <span className="text-fg-base font-medium">
                {t('demos.hero.chipAgent')}
              </span>
              <Check aria-hidden className="size-3" strokeWidth={2.5} />
            </span>
          </motion.div>
        ) : null}

        <div className="min-h-0 flex-1">
          {beat >= BEAT.clause1 ? (
            <p className="text-fg-subtle mb-2 flex items-center gap-1 text-xs">
              <ChevronRight aria-hidden className="size-3" />
              <Sparkles aria-hidden className="size-3" />
              {t('demos.hero.thought')}
            </p>
          ) : null}
          {beat >= BEAT.clause1 ? (
            <DemoStreamText
              segments={replySegments}
              visible={visibleClauses}
              streaming={beat < BEAT.status && !reduceMotion}
              className="text-fg-muted max-w-[95%] text-sm leading-relaxed md:text-[15px]"
            />
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {beat >= BEAT.clause3 ? (
              <CitationChip index={1} label={t('demos.hero.citation1')} />
            ) : null}
            {beat >= BEAT.clause4 ? (
              <CitationChip index={2} label={t('demos.hero.citation2')} />
            ) : null}
          </div>

          {beat >= BEAT.status ? (
            <motion.p
              {...pop(0.1)}
              className="text-fg-subtle mt-3 inline-flex items-center gap-1.5 text-xs"
            >
              <Check aria-hidden className="size-3.5" strokeWidth={2.5} />
              {t('demos.hero.status')}
            </motion.p>
          ) : null}
        </div>

        {/* Composer — mirrors the real chat surface: input line, then the
            agent + model pickers left and voice/send right. */}
        <div className="border-border-base bg-surface-site flex shrink-0 flex-col gap-2.5 rounded-xl border px-3.5 pt-3 pb-2.5">
          <span className="text-fg-subtle truncate text-sm">
            {t('demos.hero.inputPlaceholder')}
          </span>
          <div className="flex items-center gap-2">
            <Plus aria-hidden className="text-fg-subtle size-4" />
            <Bookmark aria-hidden className="text-fg-subtle size-3.5" />
            <span className="text-fg-muted ml-1 inline-flex items-center gap-1 text-xs font-medium">
              <Bot aria-hidden className="size-3.5" />
              {t('demos.hero.composerAgent')}
              <ChevronDown aria-hidden className="size-3" />
            </span>
            <span className="text-fg-muted inline-flex items-center gap-1 text-xs font-medium">
              <Sparkles aria-hidden className="size-3" />
              {t('demos.hero.chipAuto')}
              <ChevronDown aria-hidden className="size-3" />
            </span>
            <span className="ml-auto flex items-center gap-2.5">
              <Mic aria-hidden className="text-fg-subtle size-4" />
              <span className="bg-brand-base text-brand-fg flex size-7 shrink-0 items-center justify-center rounded-full">
                <ArrowUp aria-hidden className="size-4" />
              </span>
            </span>
          </div>
        </div>
      </div>
    </DemoShell>
  );
}

function CitationChip({ index, label }: { index: number; label: string }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.span
      initial={reduceMotion ? false : { opacity: 0, y: 4, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: easeOut }}
      className="border-border-base bg-surface-site text-fg-muted inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
    >
      <FileText aria-hidden className="size-3" />
      <span className="text-fg-subtle">[{index}]</span>
      {label}
    </motion.span>
  );
}
