import { cn } from '@tale/ui/cn';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import {
  ChevronRight,
  FileCode2,
  FolderOpen,
  Globe,
  MonitorPlay,
} from 'lucide-react';
import { useRef } from 'react';

import {
  type SandboxScenario,
  useSandboxScenario,
} from '@/app/components/blocks/demos/demo-scenarios';
import { DemoShell } from '@/app/components/blocks/demos/demo-shell';
import { useDemoTimeline } from '@/app/components/blocks/demos/use-demo-timeline';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;

const BEATS = [0, 400, 900, 1400, 2000, 2600, 3200] as const;
const BEAT = {
  frame: 0,
  prompt: 1,
  pane: 2,
  files: 3,
  code: 4,
  live: 5,
  reply: 6,
} as const;

/**
 * D9 — Sandbox agent workspace: chat thread + Files / Live side pane.
 * Vocabulary from `workspace-files-pane.tsx` (explorer + preview) and
 * `live-browser-pane.tsx` (screencast chrome) — static faux frames only,
 * never a real VNC stream.
 */
export function SandboxWorkspace({
  scenario,
}: {
  /** Story override — defaults to the homepage Claude Code sandbox scene. */
  scenario?: SandboxScenario;
}) {
  const { t } = useT('home');
  const homeScenario = useSandboxScenario();
  const scene = scenario ?? homeScenario;
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-15%' });
  const beat = useDemoTimeline({ beats: BEATS, start: inView });
  const reduceMotion = useReducedMotion();
  const showLive = beat >= BEAT.live;

  const pop = (delay = 0) => ({
    initial: reduceMotion ? false : { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.3, ease: easeOut, delay },
  });

  return (
    <div ref={ref}>
      <DemoShell
        label={scene.label}
        activeNav="chat"
        className="mx-auto aspect-[7/10] max-w-4xl sm:aspect-[16/10]"
      >
        <div className="flex h-full min-h-0">
          <div className="border-border-base flex min-w-0 flex-[0.95] flex-col border-r">
            <div className="flex min-h-0 flex-1 flex-col justify-start gap-2.5 px-3 py-3 sm:gap-3 sm:px-4 sm:py-3.5">
              {beat >= BEAT.prompt ? (
                <motion.div {...pop()} className="flex flex-col items-end">
                  <div className="bg-surface-site-inset text-fg-base max-w-[92%] rounded-2xl px-3 py-2 text-xs sm:max-w-xs sm:text-[13px]">
                    {scene.prompt}
                  </div>
                </motion.div>
              ) : null}

              {beat >= BEAT.reply ? (
                <motion.div
                  {...pop()}
                  className="flex flex-col items-start gap-1.5"
                >
                  <p className="text-fg-subtle flex items-center gap-1.5 text-[10px] sm:text-[11px]">
                    <span className="text-fg-base font-medium">
                      {scene.agent}
                    </span>
                    <span aria-hidden>·</span>
                    <span>{scene.model}</span>
                  </p>
                  <p className="text-fg-base text-xs leading-snug sm:text-[13px]">
                    {scene.reply}
                  </p>
                </motion.div>
              ) : null}
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            {beat >= BEAT.pane ? (
              <motion.div {...pop()} className="flex h-full min-h-0 flex-col">
                <div
                  role="presentation"
                  className="border-border-base flex shrink-0 gap-0.5 border-b px-1.5 pt-1.5"
                >
                  <PaneTab
                    active={!showLive}
                    icon={FolderOpen}
                    label={t('demos.sandbox.filesTab')}
                  />
                  <PaneTab
                    active={showLive}
                    icon={MonitorPlay}
                    label={t('demos.sandbox.liveTab')}
                  />
                </div>

                <div className="relative min-h-0 flex-1 overflow-hidden">
                  <div
                    className={cn(
                      'flex h-full min-h-0',
                      showLive && 'flex-col sm:flex-row',
                    )}
                  >
                    <div
                      className={cn(
                        'flex min-h-0',
                        showLive
                          ? 'border-border-base/70 max-h-[38%] shrink-0 border-b sm:max-h-none sm:w-[36%] sm:flex-col sm:border-r sm:border-b-0'
                          : 'min-w-0 flex-1',
                      )}
                    >
                      <div
                        className={cn(
                          'border-border-base/70 flex shrink-0 flex-col gap-0.5 px-1.5 py-2',
                          showLive ? 'w-full' : 'w-[42%] border-r',
                        )}
                      >
                        <p className="text-fg-subtle mb-1 truncate px-1 text-[9px] font-medium tracking-wide uppercase">
                          {t('demos.sandbox.treeRoot')}
                        </p>
                        {beat >= BEAT.files
                          ? scene.files.map((name, index) => {
                              const active = name === scene.activeFile;
                              return (
                                <motion.div
                                  key={name}
                                  {...pop(index * 0.04)}
                                  className={cn(
                                    'flex items-center gap-1 rounded px-1 py-0.5 text-[10px] md:text-[11px]',
                                    active
                                      ? 'bg-surface-site-inset text-fg-base font-medium'
                                      : 'text-fg-muted',
                                  )}
                                >
                                  {active ? (
                                    <ChevronRight
                                      aria-hidden
                                      className="size-2.5 shrink-0"
                                    />
                                  ) : (
                                    <span className="size-2.5 shrink-0" />
                                  )}
                                  <FileCode2
                                    aria-hidden
                                    className="size-3 shrink-0"
                                    strokeWidth={1.75}
                                  />
                                  <span className="truncate">{name}</span>
                                </motion.div>
                              );
                            })
                          : null}
                      </div>
                      {!showLive ? (
                        <div className="bg-surface-site-inset/40 flex min-w-0 flex-1 flex-col px-2 py-2 md:px-3">
                          <p className="text-fg-subtle mb-1.5 truncate text-[10px] font-medium">
                            {scene.activeFile}
                          </p>
                          {beat >= BEAT.code ? (
                            <motion.pre
                              {...pop()}
                              className="text-fg-muted overflow-hidden font-mono text-[9px] leading-relaxed md:text-[10px]"
                            >
                              {scene.codeLines.map((line, i) => (
                                <div key={i} className="flex gap-2">
                                  <span className="text-fg-subtle/70 w-3 shrink-0 text-right tabular-nums select-none">
                                    {i + 1}
                                  </span>
                                  <span className="text-fg-base truncate">
                                    {line}
                                  </span>
                                </div>
                              ))}
                            </motion.pre>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    {showLive ? (
                      <motion.div
                        {...pop()}
                        className="flex min-h-0 min-w-0 flex-1 flex-col p-2 md:p-2.5"
                      >
                        <div className="border-border-base bg-surface-site-raised flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border">
                          <div className="border-border-base flex items-center gap-1.5 border-b px-2 py-1.5">
                            <Globe
                              aria-hidden
                              className="text-fg-muted size-3 shrink-0"
                              strokeWidth={1.75}
                            />
                            <span className="text-fg-muted truncate font-mono text-[10px] md:text-[11px]">
                              {scene.browserUrl}
                            </span>
                          </div>
                          <div className="from-surface-site-inset to-surface-site-raised relative flex min-h-0 flex-1 flex-col items-center justify-center bg-gradient-to-b px-3">
                            <MonitorPlay
                              aria-hidden
                              className="text-fg-subtle mb-2 size-6 md:size-7"
                              strokeWidth={1.5}
                            />
                            <p className="text-fg-base text-center text-[11px] font-medium md:text-xs">
                              {scene.browserTitle}
                            </p>
                            <p className="text-fg-subtle mt-1 text-center text-[10px]">
                              {t('demos.sandbox.liveHint')}
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    ) : null}
                  </div>
                </div>
              </motion.div>
            ) : null}
          </div>
        </div>
      </DemoShell>
    </div>
  );
}

function PaneTab({
  active,
  icon: Icon,
  label,
}: {
  active: boolean;
  icon: typeof FolderOpen;
  label: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-t-md px-2 py-1 text-[10px] font-medium md:text-[11px]',
        active
          ? 'bg-surface-site text-fg-base border-border-base border border-b-transparent'
          : 'text-fg-muted',
      )}
    >
      <Icon aria-hidden className="size-3" strokeWidth={1.75} />
      {label}
    </span>
  );
}
