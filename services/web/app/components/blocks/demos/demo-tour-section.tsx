import type { ReactNode } from 'react';

import {
  type DemoTourRowLink,
  DemoTourRow,
} from '@/app/components/blocks/demos/demo-tour-row';
import { SiteContainer } from '@/app/components/layout/site-container';
import { SectionHeading } from '@/app/components/marketing/section-heading';

export interface DemoTourStage {
  /** Stable React key. */
  id: string;
  /** Already-localized numbered eyebrow, e.g. "01 Chat". */
  eyebrow: string;
  title: string;
  description: string;
  /** Optional module link rendered under the description. */
  link?: DemoTourRowLink;
  /** Scene demo — must render its own DemoShell. */
  demo: ReactNode;
}

export interface DemoTourSectionProps {
  /** Optional section heading above the first row. */
  heading?: string;
  description?: string;
  stages: readonly DemoTourStage[];
  /** Landmark label when wrapped as a section. */
  'aria-label'?: string;
  id?: string;
}

/**
 * Stacked product tour — same structure as the homepage orchestration tour:
 * optional section heading, then N DemoTourRows (copy + DemoStage + DemoShell).
 */
export function DemoTourSection({
  heading,
  description,
  stages,
  id,
  'aria-label': ariaLabel,
}: DemoTourSectionProps) {
  if (stages.length === 0) return null;

  return (
    <section
      id={id}
      aria-label={ariaLabel}
      className="bg-surface-site scroll-mt-16"
    >
      <SiteContainer>
        <div className="mx-auto max-w-280">
          {heading ? (
            <SectionHeading
              align="start"
              className="max-w-180 pt-32 pb-16 md:pt-40 md:pb-24"
              title={heading}
              description={description}
            />
          ) : (
            <div className="pt-12 md:pt-16" />
          )}

          {stages.map((stage, index) => (
            <DemoTourRow
              key={stage.id}
              eyebrow={stage.eyebrow}
              title={stage.title}
              description={stage.description}
              link={stage.link}
              isLast={index === stages.length - 1}
            >
              {stage.demo}
            </DemoTourRow>
          ))}
        </div>
      </SiteContainer>
    </section>
  );
}
