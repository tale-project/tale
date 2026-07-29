import { cn } from '@tale/ui/cn';
import type { ReactNode } from 'react';

import {
  PageSection,
  Reveal,
  SectionHeading,
  type PageSectionProps,
} from '@/app/components/marketing';

interface LogoCloudSectionProps {
  title: string;
  description: string;
  /** Extra classes on the outer PageSection (e.g. overflow / raised surface). */
  className?: string;
  /** Vertical section padding — agents uses `md` for a denser band. */
  pad?: PageSectionProps['pad'];
  /** Gap between heading and body — agents uses tighter, marquee uses looser. */
  gapClassName?: string;
  /**
   * Compact heading scale for short logo strips (agents). Connectors keeps
   * the default subsection size.
   */
  dense?: boolean;
  children: ReactNode;
}

/**
 * Shared homepage logo-cloud band — PageSection + Reveal + subsection heading.
 * Agents grid and connectors marquee compose this; only the body differs.
 */
export function LogoCloudSection({
  title,
  description,
  className,
  pad = 'lg',
  gapClassName = 'gap-12 md:gap-14',
  dense = false,
  children,
}: LogoCloudSectionProps) {
  return (
    <PageSection surface="site" pad={pad} border="t" className={className}>
      <Reveal
        className={cn(
          'mx-auto flex w-full max-w-280 flex-col items-center overflow-hidden',
          gapClassName,
        )}
      >
        <SectionHeading
          bare
          size="subsection"
          title={title}
          description={description}
          className={
            dense
              ? 'gap-2 md:gap-3 [&_h2]:text-2xl [&_h2]:tracking-[-0.035em] md:[&_h2]:text-3xl'
              : undefined
          }
          descriptionClassName={
            dense ? 'max-w-2xl text-sm md:text-base' : undefined
          }
        />
        {children}
      </Reveal>
    </PageSection>
  );
}
