import type { ReactNode } from 'react';

import { MarketingStack, PageSection, SectionHeading } from '../marketing';

type Variant = 'lead' | 'subsection';

interface MarketingSectionProps {
  title: ReactNode;
  description?: ReactNode;
  /**
   * `lead` is the page's primary section: same chrome as `FeatureHero`
   * (`display` h1 on the root hero wash). `subsection` is a follow-up
   * block like a compare table: `h2`, smaller heading, no hero wash.
   */
  variant?: Variant;
  /** Slot for control toggles rendered between the header and the body. */
  controls?: ReactNode;
  /** Optional page-specific illustration alongside the lead copy. */
  visual?: ReactNode;
  /** Trailing note rendered below the body. */
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * Pricing / hardware page section shell. Lead variant matches `FeatureHero`
 * heading chrome so pricing/hardware share the same page header as platform
 * pages; subsection keeps the quieter follow-up band. Lead stays transparent
 * so the root `bg-gradient-site-hero` wash continues under the sticky nav.
 */
export function MarketingSection({
  title,
  description,
  variant = 'lead',
  controls,
  visual,
  footer,
  children,
}: MarketingSectionProps) {
  const isLead = variant === 'lead';

  return (
    <PageSection
      pad={isLead ? 'xl' : 'lg'}
      border="b"
      className={isLead ? 'relative overflow-hidden' : 'relative'}
    >
      {isLead ? (
        <div
          className={
            visual
              ? 'grid min-w-0 items-center gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-16'
              : undefined
          }
        >
          <MarketingStack
            max={visual ? 'full' : 'lg'}
            gap="lg"
            align={visual ? 'start' : 'center'}
            className="relative"
          >
            <SectionHeading
              size="display"
              as="h1"
              title={title}
              description={description}
              descriptionClassName="max-w-2xl"
              align={visual ? 'start' : 'center'}
            />
            {controls ? (
              <div
                className={
                  visual
                    ? 'flex flex-wrap items-center gap-3'
                    : 'flex flex-col items-center gap-3 md:flex-row md:flex-wrap md:justify-center md:gap-3'
                }
              >
                {controls}
              </div>
            ) : null}
          </MarketingStack>
          {visual ? <div className="min-w-0">{visual}</div> : null}
        </div>
      ) : (
        <>
          <SectionHeading
            size="subsection"
            as="h2"
            title={title}
            description={description}
            className="mx-auto max-w-[1120px]"
          />
          {controls ? (
            <div className="mx-auto mt-10 flex flex-col items-center gap-3 md:flex-row md:flex-wrap md:justify-center md:gap-3">
              {controls}
            </div>
          ) : null}
        </>
      )}

      {children}

      {footer ? (
        <p className="text-fg-muted mx-auto mt-10 max-w-[720px] text-center text-sm leading-normal tracking-tight">
          {footer}
        </p>
      ) : null}
    </PageSection>
  );
}
