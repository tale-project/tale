import { motion, useReducedMotion } from 'framer-motion';
import type { ElementType, ReactNode } from 'react';

import { SiteContainer } from '@/app/components/layout/site-container';

const easeOut = [0.22, 1, 0.36, 1] as const;

type Variant = 'lead' | 'subsection';

interface MarketingSectionProps {
  title: ReactNode;
  description?: ReactNode;
  /**
   * `lead` is the page's primary section: `h1`, larger heading, narrow
   * header column, scroll-anchored for nav links. `subsection` is a
   * follow-up block like a compare table: `h2`, smaller heading, wider
   * column, no anchor offset.
   */
  variant?: Variant;
  /** Slot for control toggles rendered between the header and the body. */
  controls?: ReactNode;
  /** Trailing note rendered below the body. */
  footer?: ReactNode;
  /** Override the description's max width (px). Defaults: lead 640, subsection unbounded. */
  descriptionMaxWidth?: number;
  children: ReactNode;
}

export function MarketingSection({
  title,
  description,
  variant = 'lead',
  controls,
  footer,
  descriptionMaxWidth,
  children,
}: MarketingSectionProps) {
  const reduceMotion = useReducedMotion();
  const isLead = variant === 'lead';
  const HeadingTag: ElementType = isLead ? 'h1' : 'h2';
  const fadeY = isLead ? 24 : 20;
  const fadeInitial = reduceMotion ? false : { opacity: 0, y: fadeY };
  const headerMaxWidth = isLead ? 'max-w-[720px]' : 'max-w-[1120px]';
  const headingSize = isLead ? 'md:text-[52px]' : 'md:text-[48px]';
  const headingLineHeight = isLead ? 1.077 : 1.083;
  const descriptionStyle =
    descriptionMaxWidth !== undefined
      ? { maxWidth: `${descriptionMaxWidth}px` }
      : undefined;

  return (
    <section
      className={`border-border-base${isLead ? ' scroll-mt-16' : ''} border-b py-20`}
    >
      <SiteContainer>
        <motion.header
          initial={fadeInitial}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-15%' }}
          transition={
            reduceMotion ? { duration: 0 } : { duration: 0.6, ease: easeOut }
          }
          className={`mx-auto flex ${headerMaxWidth} flex-col items-center gap-3 text-center`}
        >
          <HeadingTag
            className={`text-fg-base text-3xl font-medium ${headingSize}`}
            style={{ letterSpacing: '-2.14px', lineHeight: headingLineHeight }}
          >
            {title}
          </HeadingTag>
          {description ? (
            <p
              className="text-fg-muted text-base md:text-lg"
              style={{
                letterSpacing: '-0.27px',
                lineHeight: 1.556,
                ...descriptionStyle,
              }}
            >
              {description}
            </p>
          ) : null}
        </motion.header>

        {controls ? (
          <div className="mx-auto mt-10 flex flex-col items-center gap-3 md:flex-row md:flex-wrap md:justify-center md:gap-4">
            {controls}
          </div>
        ) : null}

        {children}

        {footer ? (
          <p
            className="text-fg-muted mx-auto mt-10 max-w-[720px] text-center text-sm"
            style={{ letterSpacing: '-0.21px', lineHeight: 1.5 }}
          >
            {footer}
          </p>
        ) : null}
      </SiteContainer>
    </section>
  );
}
