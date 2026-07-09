import { cn } from '@tale/ui/cn';
import { Layers, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { TrustCertifications } from '@/app/components/blocks/trust-certifications';
import { SiteContainer } from '@/app/components/layout/site-container';
import { Reveal } from '@/app/components/marketing/reveal';
import { useT } from '@/lib/i18n/client';

// Inset vertical divider on the right edge at lg+, matching the .pen
// design's `padding:[32,0]` divider frame. Below lg the cells stack and
// use a full-width `border-b` instead.
const dividerRightClass =
  "lg:relative lg:after:pointer-events-none lg:after:absolute lg:after:right-0 lg:after:top-8 lg:after:bottom-8 lg:after:w-px lg:after:bg-[var(--color-border-base)] lg:after:content-['']";

export function ComplianceTrust() {
  const { t } = useT('home');

  return (
    <section className="bg-surface-site py-16 md:py-24">
      <SiteContainer>
        <Reveal className="border-border-base bg-surface-site-raised mx-auto grid max-w-[1120px] grid-cols-1 overflow-hidden rounded-xl border lg:grid-cols-[380px_1fr_1fr]">
          <div
            className={cn(
              'border-border-base flex flex-col justify-center gap-4 border-b p-8 lg:border-b-0 lg:p-12',
              dividerRightClass,
            )}
          >
            <p className="text-fg-subtle text-[13px] font-normal tracking-[0.08em] uppercase">
              {t('compliance.eyebrow')}
            </p>
            <h2
              className="text-fg-base text-3xl font-normal tracking-[-0.035em] md:text-[40px] md:tracking-[-0.04em]"
              style={{ lineHeight: 1.08 }}
            >
              {t('compliance.title')}
            </h2>
            <TrustCertifications variant="badges" />
          </div>

          <FeatureColumn
            icon={Layers}
            title={t('compliance.independent.title')}
            description={t('compliance.independent.description')}
            className={cn(
              'border-border-base border-b lg:border-b-0',
              dividerRightClass,
            )}
          />

          <FeatureColumn
            icon={ShieldCheck}
            title={t('compliance.certified.title')}
            description={t('compliance.certified.description')}
          />
        </Reveal>
      </SiteContainer>
    </section>
  );
}

interface FeatureColumnProps {
  icon: LucideIcon;
  title: string;
  description: string;
  className?: string;
}

function FeatureColumn({
  icon: Icon,
  title,
  description,
  className,
}: FeatureColumnProps) {
  return (
    <div
      className={`flex flex-col items-start gap-4 p-8 lg:p-12 ${className ?? ''}`}
    >
      <div className="border-border-base bg-surface-site-deep flex size-12 items-center justify-center rounded-xl border-[3px]">
        <Icon aria-hidden className="text-fg-muted size-6" strokeWidth={1.75} />
      </div>
      <h3
        className="text-fg-base text-xl font-medium"
        style={{ letterSpacing: '-1px' }}
      >
        {title}
      </h3>
      <p
        className="text-fg-subtle text-[15px]"
        style={{ letterSpacing: '-0.1px', lineHeight: 1.55 }}
      >
        {description}
      </p>
    </div>
  );
}
