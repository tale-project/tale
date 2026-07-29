import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { DemoStage } from '@/app/components/blocks/demos/demo-stage';
import type { LocalizedRoutePath } from '@/app/components/layout/localized-link';
import { MarketingLink } from '@/app/components/marketing/link';
import { Reveal } from '@/app/components/marketing/reveal';

export interface DemoTourRowLink {
  /** Already-localized label, e.g. "Explore Automations". */
  label: string;
  to: LocalizedRoutePath;
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
}

/**
 * One homepage-style tour band: copy (eyebrow + title | description) then a
 * full-width DemoStage. Shared by OrchestrationTour and platform FeatureTour.
 */
export function DemoTourRow({
  eyebrow,
  title,
  description,
  link,
  children,
  isLast = false,
}: DemoTourRowProps) {
  return (
    <Reveal
      className={`flex flex-col gap-10 py-20 md:gap-14 md:py-32 ${
        isLast ? '' : 'border-border-base/70 border-b'
      }`}
    >
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:items-end md:gap-20">
        <div className="flex flex-col gap-3">
          <p className="text-fg-subtle text-[13px] font-normal tracking-[0.02em]">
            {eyebrow}
          </p>
          <h3
            className="text-fg-base text-3xl font-normal tracking-[-0.04em] whitespace-pre-line md:text-[48px] md:tracking-[-0.045em]"
            style={{ lineHeight: 1.05 }}
          >
            {title}
          </h3>
        </div>
        <div className="flex flex-col gap-3 md:max-w-125">
          <p
            className="text-fg-muted whitespace-pre-line md:text-lg"
            style={{ lineHeight: 1.55 }}
          >
            {description}
          </p>
          {link ? (
            <MarketingLink
              to={link.to}
              tone="inline"
              className="inline-flex w-fit items-center gap-1 text-sm"
            >
              {link.label}
              <ArrowRight aria-hidden className="size-3.5" strokeWidth={1.75} />
            </MarketingLink>
          ) : null}
        </div>
      </div>
      <DemoStage>{children}</DemoStage>
    </Reveal>
  );
}
