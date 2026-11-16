import { cn } from '@tale/ui/cn';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { MarketingLink } from '../marketing/link';
import { Reveal } from '../marketing/reveal';
import { DemoStage } from './demo-stage';

export interface DemoTourRowLink {
  /** Already-localized label, e.g. "Explore Automations". */
  label: string;
  /** Site path — rendered through the host's link component. */
  to: string;
}

interface DemoTourRowProps {
  /** Numbered eyebrow, e.g. "01 Agents & connectors". */
  eyebrow: string;
  /** Large stage title — may include `\n` for line breaks. */
  title: string;
  description: string;
  /** Optional module link rendered under the description. */
  link?: DemoTourRowLink;
  /** Product demo (already wrapped in DemoShell by the scene). */
  children: ReactNode;
  /** Omit the bottom hairline on the last row. */
  isLast?: boolean;
  /** Alternate the desktop composition; reading order stays copy then illustration. */
  reverse?: boolean;
}

/**
 * Product story: copy beside its illustration on desktop, copy then demo
 * on phones and tablets. Shared by homepage and platform feature tours.
 */
export function DemoTourRow({
  eyebrow,
  title,
  description,
  link,
  children,
  isLast = false,
  reverse = false,
}: DemoTourRowProps) {
  return (
    <Reveal
      className={cn(
        'grid min-w-0 grid-cols-1 items-center gap-8 py-12 sm:gap-10 sm:py-16 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)] lg:gap-14 lg:py-20',
        reverse && 'lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)]',
        !isLast && 'border-border-base border-b',
      )}
    >
      <div
        className={cn(
          'flex min-w-0 flex-col gap-6',
          reverse && 'lg:col-start-2 lg:row-start-1',
        )}
      >
        <div className="flex flex-col gap-3">
          <p className="text-fg-muted flex items-center gap-3 text-xs font-medium tracking-[0.04em] before:h-px before:w-6 before:bg-current">
            {eyebrow}
          </p>
          <h3
            className="text-fg-base text-site-subsection font-medium tracking-[-0.045em] text-balance [overflow-wrap:anywhere] whitespace-pre-line"
            style={{ lineHeight: 1.1 }}
          >
            {title}
          </h3>
        </div>
        <div className="flex flex-col gap-5 lg:max-w-96">
          <p
            className="text-fg-muted text-base text-pretty whitespace-pre-line"
            style={{ lineHeight: 1.55 }}
          >
            {description}
          </p>
          {link ? (
            <MarketingLink
              to={link.to}
              tone="inline"
              className="group inline-flex min-h-11 w-fit items-center gap-2 text-sm font-medium"
            >
              {link.label}
              <ArrowRight
                aria-hidden
                className="size-3.5 transition-transform duration-200 motion-safe:group-hover:translate-x-1 motion-safe:group-focus-visible:translate-x-1 motion-reduce:transition-none"
                strokeWidth={1.75}
              />
            </MarketingLink>
          ) : null}
        </div>
      </div>
      <DemoStage
        className={cn('min-w-0', reverse && 'lg:col-start-1 lg:row-start-1')}
      >
        {children}
      </DemoStage>
    </Reveal>
  );
}
