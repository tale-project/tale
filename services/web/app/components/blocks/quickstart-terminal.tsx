'use client';

import { cn } from '@tale/ui/cn';
import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { MarketingExternalLink } from '@/app/components/marketing/external-link';
import { SELF_HOSTED_QUICKSTART_URL } from '@/lib/docs-url';

// The real self-hosted quickstart, verbatim — source of truth:
// docs/en/self-hosted/install/quickstart.md. Update both together.
export const QUICKSTART_COMMANDS = [
  'curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash',
  'tale init my-project',
  'cd my-project',
  'tale dev',
] as const;

const COPY_TEXT = QUICKSTART_COMMANDS.join('\n');

interface QuickstartTerminalProps {
  /** Localized uppercase label in the chrome bar. */
  title: string;
  /** Accessible + visible label for the copy button (idle). */
  copyLabel: string;
  /** Accessible + visible label after a successful copy. */
  copiedLabel: string;
  /** Footer link to the full self-hosted quickstart. */
  docsLabel: string;
  className?: string;
}

/**
 * The self-hosted quickstart as a compact ink terminal — always dark chrome
 * (`ink-terminal` tokens), shell highlighting, one-click copy, and a docs
 * deep-link.
 */
export function QuickstartTerminal({
  title,
  copyLabel,
  copiedLabel,
  docsLabel,
  className,
}: QuickstartTerminalProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const markCopied = () => {
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1800);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(COPY_TEXT);
      markCopied();
    } catch (error) {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = COPY_TEXT;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (ok) {
          markCopied();
          return;
        }
      } catch {
        // fall through
      }
      console.warn('[quickstart-terminal] clipboard write failed', error);
    }
  };

  return (
    <div
      className={cn(
        'border-ink-terminal-fg/10 bg-ink-terminal shadow-demo relative mx-auto w-full max-w-160 overflow-hidden rounded-xl text-left',
        'ring-1 ring-black/[0.04] dark:ring-white/[0.06]',
        className,
      )}
    >
      <div className="relative flex items-center gap-2.5 border-b border-white/10 px-3 py-1.5 md:px-3.5">
        <span aria-hidden className="flex shrink-0 items-center gap-1">
          <span className="bg-demo-traffic-close size-2 rounded-full" />
          <span className="bg-demo-traffic-min size-2 rounded-full" />
          <span className="bg-demo-traffic-max size-2 rounded-full" />
        </span>
        <p className="text-ink-terminal-fg/45 min-w-0 flex-1 truncate text-[10px] font-normal tracking-[0.06em] uppercase">
          {title}
        </p>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? copiedLabel : copyLabel}
          aria-live="polite"
          className={cn(
            'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30',
            copied
              ? 'bg-emerald-400/15 text-emerald-300'
              : 'text-ink-terminal-fg/60 hover:text-ink-terminal-fg bg-white/[0.05] hover:bg-white/[0.09]',
          )}
        >
          {copied ? (
            <Check className="size-3" aria-hidden strokeWidth={2.25} />
          ) : (
            <Copy className="size-3" aria-hidden strokeWidth={2} />
          )}
          <span className="hidden sm:inline">
            {copied ? copiedLabel : copyLabel}
          </span>
        </button>
      </div>

      <pre className="relative m-0 px-3 py-2.5 font-mono text-[11.5px] leading-[1.7] whitespace-pre-wrap md:px-3.5 md:text-xs">
        <code className="flex flex-col gap-1">
          {QUICKSTART_COMMANDS.map((command) => (
            <span key={command} className="flex gap-2">
              <span
                aria-hidden
                className="shrink-0 text-emerald-400/65 select-none"
              >
                $
              </span>
              <span className="text-ink-terminal-fg min-w-0 break-all">
                {highlightShell(command)}
              </span>
            </span>
          ))}
        </code>
      </pre>

      <div className="relative border-t border-white/10 px-3 py-1.5 md:px-3.5">
        <MarketingExternalLink
          href={SELF_HOSTED_QUICKSTART_URL}
          tone="plain"
          showIcon
          className="text-ink-terminal-fg/40 hover:text-ink-terminal-fg/75 text-[11px] transition-colors"
        >
          {docsLabel}
        </MarketingExternalLink>
      </div>
    </div>
  );
}

/** Fixed-command highlighter — no Shiki; keeps the marketing card SSR-stable. */
function highlightShell(command: string): ReactNode {
  if (command.startsWith('curl ')) {
    return (
      <>
        <Cmd>curl</Cmd>
        <Flag> -fsSL </Flag>
        <Url>
          https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh
        </Url>
        <Muted> | </Muted>
        <Cmd>bash</Cmd>
      </>
    );
  }
  if (command === 'tale init my-project') {
    return (
      <>
        <Cmd>tale</Cmd>
        <Arg> init </Arg>
        <Path>my-project</Path>
      </>
    );
  }
  if (command === 'cd my-project') {
    return (
      <>
        <Cmd>cd</Cmd> <Path>my-project</Path>
      </>
    );
  }
  if (command === 'tale dev') {
    return (
      <>
        <Cmd>tale</Cmd>
        <Arg> dev</Arg>
      </>
    );
  }
  return command;
}

function Cmd({ children }: { children: ReactNode }) {
  return <span className="text-sky-300">{children}</span>;
}

function Flag({ children }: { children: ReactNode }) {
  return <span className="text-ink-terminal-fg/50">{children}</span>;
}

function Url({ children }: { children: ReactNode }) {
  return <span className="text-amber-200/75">{children}</span>;
}

function Arg({ children }: { children: ReactNode }) {
  return <span className="text-ink-terminal-fg/75">{children}</span>;
}

function Path({ children }: { children: ReactNode }) {
  return <span className="text-emerald-300/90">{children}</span>;
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="text-ink-terminal-fg/35">{children}</span>;
}
