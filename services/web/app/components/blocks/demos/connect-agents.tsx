import { cn } from '@tale/ui/cn';
import { TaleLogo } from '@tale/ui/logo';
import {
  motion,
  useInView,
  useReducedMotion,
  type Variants,
} from 'framer-motion';
import { Check } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { useRef } from 'react';

import { GithubIcon } from '@/app/components/icons/github-icon';
import {
  ClaudeIcon,
  GmailIcon,
  OpenAIIcon,
  SlackIcon,
} from '@/app/components/icons/integration-icons';
import { MicrosoftIcon } from '@/app/components/icons/microsoft-icon';
import { useT } from '@/lib/i18n/client';

import { DemoShell } from './demo-shell';
import { useDemoTimeline } from './use-demo-timeline';

const easeOut = [0.22, 1, 0.36, 1] as const;

const BEATS = [0, 300, 1600, 2800, 4000] as const;
const BEAT = { frame: 0, tiles: 1, wires: 2, docked: 3, done: 4 } as const;

type BrandIcon = ComponentType<
  SVGProps<SVGSVGElement> & { className?: string }
>;

// Brand names are product identifiers, not translatable copy — same
// convention as integrations-bar.tsx.
const LEFT: readonly { Icon: BrandIcon; name: string }[] = [
  { Icon: ClaudeIcon, name: 'Claude Code' },
  { Icon: OpenAIIcon, name: 'Codex' },
  { Icon: GithubIcon, name: 'GitHub' },
];
const RIGHT: readonly { Icon: BrandIcon; name: string }[] = [
  { Icon: SlackIcon, name: 'Slack' },
  { Icon: GmailIcon, name: 'Gmail' },
  { Icon: MicrosoftIcon, name: 'Microsoft 365' },
];

/**
 * D2 — the agents and tools a team already uses dock into one Tale hub:
 * tiles stagger in, the wires fill toward the centre, every connection
 * gets its tick.
 */
export function ConnectAgents() {
  const { t } = useT('home');
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-15%' });
  const beat = useDemoTimeline({ beats: BEATS, start: inView });
  const reduceMotion = useReducedMotion();

  const tileVariants = {
    hidden: reduceMotion ? {} : { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: easeOut } },
  };

  return (
    <div ref={ref}>
      <DemoShell
        label={t('demos.connect.label')}
        title={t('demos.connect.windowTitle')}
        className="mx-auto aspect-[7/10] max-w-4xl sm:aspect-[16/9]"
      >
        <div className="flex h-full items-center justify-center p-4 md:p-6">
          <motion.div
            initial={reduceMotion ? false : 'hidden'}
            animate={beat >= BEAT.tiles ? 'visible' : 'hidden'}
            variants={{
              hidden: {},
              visible: { transition: { staggerChildren: 0.12 } },
            }}
            className="grid w-full max-w-2xl grid-cols-[1fr_auto_1fr] items-center gap-x-2 md:gap-x-0"
          >
            <div className="flex flex-col gap-2.5 md:gap-3">
              {LEFT.map((entry) => (
                <BrandTile
                  key={entry.name}
                  entry={entry}
                  docked={beat >= BEAT.docked}
                  variants={tileVariants}
                />
              ))}
            </div>

            <div className="flex items-center">
              <Wire filled={beat >= BEAT.wires} />
              <motion.div
                animate={
                  reduceMotion || beat < BEAT.done
                    ? {}
                    : { scale: [1, 1.05, 1] }
                }
                transition={{
                  duration: 2.4,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
                className="border-border-base bg-surface-site z-10 flex size-16 items-center justify-center rounded-2xl border-[3px] md:size-20"
              >
                <TaleLogo className="h-5 w-auto md:h-6" />
              </motion.div>
              <Wire filled={beat >= BEAT.wires} />
            </div>

            <div className="flex flex-col gap-2.5 md:gap-3">
              {RIGHT.map((entry) => (
                <BrandTile
                  key={entry.name}
                  entry={entry}
                  docked={beat >= BEAT.docked}
                  variants={tileVariants}
                  alignEnd
                />
              ))}
            </div>
          </motion.div>
        </div>
      </DemoShell>
    </div>
  );
}

function Wire({ filled }: { filled: boolean }) {
  return (
    <div
      aria-hidden
      className="bg-border-base relative h-px w-4 overflow-hidden md:w-10"
    >
      <div
        className={cn(
          'bg-accent-base absolute inset-0 origin-left scale-x-0 transition-transform duration-700',
          filled && 'scale-x-100',
        )}
      />
    </div>
  );
}

function BrandTile({
  entry,
  docked,
  variants,
  alignEnd,
}: {
  entry: { Icon: BrandIcon; name: string };
  docked: boolean;
  variants: Variants;
  alignEnd?: boolean;
}) {
  return (
    <motion.div
      variants={variants}
      className={cn(
        'border-border-base bg-surface-site flex items-center gap-2 rounded-xl border px-2.5 py-2 md:px-3',
        alignEnd && 'flex-row-reverse',
      )}
    >
      <span className="border-border-base bg-surface-site-deep flex size-8 shrink-0 items-center justify-center rounded-lg border md:size-9">
        <entry.Icon aria-hidden className="size-4.5 md:size-5" />
      </span>
      <span className="text-fg-base min-w-0 flex-1 truncate text-xs font-medium md:text-[13px]">
        {entry.name}
      </span>
      {docked ? (
        <Check
          aria-hidden
          className="text-fg-muted size-3.5 shrink-0"
          strokeWidth={2.5}
        />
      ) : null}
    </motion.div>
  );
}
