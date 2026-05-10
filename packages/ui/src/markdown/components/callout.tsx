import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Lightbulb,
  type LucideIcon,
  OctagonAlert,
  StickyNote,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';

type Tone = 'note' | 'tip' | 'info' | 'warning' | 'danger' | 'check';

const TONE_CONFIG: Record<
  Tone,
  { icon: LucideIcon; label: string; className: string }
> = {
  note: {
    icon: StickyNote,
    label: 'Note',
    className:
      'border-border-base bg-bg-elevated/50 text-fg-base [&_svg]:text-fg-muted',
  },
  tip: {
    icon: Lightbulb,
    label: 'Tip',
    className:
      'border-emerald-500/30 bg-emerald-500/[0.06] text-fg-base [&_svg]:text-emerald-600 dark:[&_svg]:text-emerald-400',
  },
  info: {
    icon: Info,
    label: 'Info',
    className:
      'border-sky-500/30 bg-sky-500/[0.06] text-fg-base [&_svg]:text-sky-600 dark:[&_svg]:text-sky-400',
  },
  warning: {
    icon: AlertTriangle,
    label: 'Warning',
    className:
      'border-amber-500/40 bg-amber-500/[0.06] text-fg-base [&_svg]:text-amber-600 dark:[&_svg]:text-amber-400',
  },
  danger: {
    icon: OctagonAlert,
    label: 'Caution',
    className:
      'border-red-500/40 bg-red-500/[0.06] text-fg-base [&_svg]:text-red-600 dark:[&_svg]:text-red-400',
  },
  check: {
    icon: CheckCircle2,
    label: 'Success',
    className:
      'border-emerald-500/30 bg-emerald-500/[0.06] text-fg-base [&_svg]:text-emerald-600 dark:[&_svg]:text-emerald-400',
  },
};

interface CalloutProps {
  tone: Tone;
  children?: ReactNode;
  className?: string;
}

export function Callout({ tone, children, className }: CalloutProps) {
  const config = TONE_CONFIG[tone];
  const Icon = config.icon;
  return (
    <aside
      role="note"
      aria-label={config.label}
      className={cn(
        // Force foreground colour onto descendants so embedded markdown
        // (paragraphs, links, inline code) doesn't fall back to the muted
        // colours the base markdown renderer applies outside callouts.
        'my-6 flex gap-3 rounded-lg border px-4 py-3 text-sm leading-relaxed',
        '[&_p]:text-fg-base [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
        '[&_li]:text-fg-base [&_strong]:text-fg-base',
        '[&_a]:text-fg-base [&_a]:underline [&_a]:underline-offset-4',
        '[&_code]:text-fg-base',
        config.className,
        className,
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </aside>
  );
}

export const Note = (props: Omit<CalloutProps, 'tone'>) => (
  <Callout tone="note" {...props} />
);
export const Tip = (props: Omit<CalloutProps, 'tone'>) => (
  <Callout tone="tip" {...props} />
);
export const InfoCallout = (props: Omit<CalloutProps, 'tone'>) => (
  <Callout tone="info" {...props} />
);
export const Warning = (props: Omit<CalloutProps, 'tone'>) => (
  <Callout tone="warning" {...props} />
);
export const Danger = (props: Omit<CalloutProps, 'tone'>) => (
  <Callout tone="danger" {...props} />
);
export const CheckCallout = (props: Omit<CalloutProps, 'tone'>) => (
  <Callout tone="check" {...props} />
);
