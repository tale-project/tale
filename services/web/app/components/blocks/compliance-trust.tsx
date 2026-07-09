import { cn } from '@tale/ui/cn';
import { motion } from 'framer-motion';
import { Layers, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { SiteContainer } from '@/app/components/layout/site-container';
import { useT } from '@/lib/i18n/client';
import { useSkipEntrance } from '@/lib/motion/entrance';

const easeOut = [0.22, 1, 0.36, 1] as const;

// Inset vertical divider on the right edge at lg+, matching the .pen
// design's `padding:[32,0]` divider frame. Below lg the cells stack and
// use a full-width `border-b` instead.
const dividerRightClass =
  "lg:relative lg:after:pointer-events-none lg:after:absolute lg:after:right-0 lg:after:top-8 lg:after:bottom-8 lg:after:w-px lg:after:bg-[var(--color-border-base)] lg:after:content-['']";

export function ComplianceTrust() {
  const { t } = useT('home');
  const { t: tCert } = useT('complianceTrust');
  const skipEntrance = useSkipEntrance();

  return (
    <section className="bg-surface-site py-12 md:py-16">
      <SiteContainer>
        <motion.div
          initial={skipEntrance ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-15%' }}
          transition={
            skipEntrance ? { duration: 0 } : { duration: 0.6, ease: easeOut }
          }
          className="border-border-base bg-surface-site-raised mx-auto grid max-w-[1120px] grid-cols-1 overflow-hidden rounded-2xl border lg:grid-cols-[380px_1fr_1fr]"
        >
          <div
            className={cn(
              'border-border-base flex flex-col justify-center gap-4 border-b p-8 lg:border-b-0 lg:p-12',
              dividerRightClass,
            )}
          >
            <p className="text-fg-subtle text-[13px] font-semibold tracking-[1.5px] uppercase">
              {t('compliance.eyebrow')}
            </p>
            <h2
              className="text-fg-base text-3xl font-medium md:text-[40px]"
              style={{ letterSpacing: '-1.6px', lineHeight: 1.1 }}
            >
              {t('compliance.title')}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge>{tCert('certifications.iso27001')}</Badge>
              <Badge>{tCert('certifications.soc2')}</Badge>
              <Badge>{tCert('certifications.gdpr')}</Badge>
            </div>
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
        </motion.div>
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

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="border-border-base bg-bg-muted text-fg-muted inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium">
      <ShieldCheck
        aria-hidden
        className="text-fg-subtle size-3.5"
        strokeWidth={1.75}
      />
      {children}
    </span>
  );
}
