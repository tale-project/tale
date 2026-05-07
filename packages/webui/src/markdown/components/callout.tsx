import { cn } from '@tale/ui/cn';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Lightbulb,
  type LucideIcon,
  StickyNote,
} from 'lucide-react';
import type { ReactNode } from 'react';

type Tone = 'note' | 'tip' | 'info' | 'warning' | 'check';

const TONE_CONFIG: Record<
  Tone,
  { icon: LucideIcon; label: string; className: string }
> = {
  note: {
    icon: StickyNote,
    label: 'Note',
    className: 'border-border-base bg-bg-elevated/50 text-fg-base',
  },
  tip: {
    icon: Lightbulb,
    label: 'Tip',
    className:
      'border-emerald-500/30 bg-emerald-500/[0.06] text-fg-base [&_svg]:text-emerald-600',
  },
  info: {
    icon: Info,
    label: 'Info',
    className:
      'border-sky-500/30 bg-sky-500/[0.06] text-fg-base [&_svg]:text-sky-600',
  },
  warning: {
    icon: AlertTriangle,
    label: 'Warning',
    className:
      'border-amber-500/40 bg-amber-500/[0.06] text-fg-base [&_svg]:text-amber-600',
  },
  check: {
    icon: CheckCircle2,
    label: 'Success',
    className:
      'border-emerald-500/30 bg-emerald-500/[0.06] text-fg-base [&_svg]:text-emerald-600',
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
        'my-6 flex gap-3 rounded-lg border px-4 py-3 text-sm leading-relaxed [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
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
export const CheckCallout = (props: Omit<CalloutProps, 'tone'>) => (
  <Callout tone="check" {...props} />
);
