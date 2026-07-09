import { motion } from 'framer-motion';
import { Scale, Server, ShieldCheck, type LucideIcon } from 'lucide-react';

import { SiteContainer } from '@/app/components/layout/site-container';
import { MARKETING_EASE } from '@/app/components/marketing/reveal';
import { SectionHeading } from '@/app/components/marketing/section-heading';
import { useT } from '@/lib/i18n/client';
import { useSkipEntrance } from '@/lib/motion/entrance';

const PILLARS = [
  { key: 'selfHosted', Icon: Server },
  { key: 'security', Icon: ShieldCheck },
  { key: 'openSource', Icon: Scale },
] as const;

export function Tagline() {
  const { t } = useT('home');
  const skipEntrance = useSkipEntrance();

  return (
    <section className="border-border-base bg-surface-site border-b py-24 md:py-32">
      <SiteContainer>
        <SectionHeading
          align="start"
          className="max-w-180"
          title={t('tagline.title')}
          description={t('tagline.subtitle')}
        />
      </SiteContainer>

      <div className="mx-auto mt-12 w-full max-w-7xl md:px-20">
        {/* Stagger stays opacity-only so pillar cards don't shift layout. */}
        <motion.div
          initial={skipEntrance ? false : 'hidden'}
          whileInView={skipEntrance ? undefined : 'visible'}
          viewport={{ once: true, margin: '-10%' }}
          variants={{
            hidden: {},
            visible: {
              transition: { staggerChildren: 0.08, delayChildren: 0.1 },
            },
          }}
          className="mx-auto grid max-w-280 grid-cols-1 md:grid-cols-3"
        >
          {PILLARS.map((pillar, index) => (
            <PillarCard
              key={pillar.key}
              pillarKey={pillar.key}
              Icon={pillar.Icon}
              showLeftBorder={index > 0}
              skipEntrance={skipEntrance}
            />
          ))}
        </motion.div>
      </div>
    </section>
  );
}

interface PillarCardProps {
  pillarKey: (typeof PILLARS)[number]['key'];
  Icon: LucideIcon;
  showLeftBorder: boolean;
  skipEntrance: boolean;
}

const pillarVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.5, ease: MARKETING_EASE },
  },
};

function PillarCard({
  pillarKey,
  Icon,
  showLeftBorder,
  skipEntrance,
}: PillarCardProps) {
  const { t } = useT('home');
  return (
    <motion.div
      variants={skipEntrance ? undefined : pillarVariants}
      className={`flex flex-col ${
        showLeftBorder
          ? 'border-border-base border-t md:border-t-0 md:border-l'
          : ''
      }`}
    >
      <div
        aria-hidden
        className="bg-surface-wash shadow-site-inset relative flex h-40 items-center justify-center overflow-hidden md:h-48"
      >
        <span className="border-border-base bg-surface-site-raised/80 shadow-site-card absolute size-14 -translate-x-5 translate-y-3 -rotate-6 rounded-xl border" />
        <span className="border-border-base bg-surface-site-raised/80 shadow-site-card absolute size-14 translate-x-6 -translate-y-3 rotate-6 rounded-xl border" />
        <span className="border-border-base bg-surface-site-raised shadow-site-card relative flex size-14 items-center justify-center rounded-xl border">
          <Icon className="text-fg-base size-6" strokeWidth={1.5} />
        </span>
      </div>
      <div className="flex flex-col gap-3 px-6 py-8 md:px-10">
        <h3 className="text-fg-base text-xl font-normal tracking-[-0.02em]">
          {t(`tagline.pillars.${pillarKey}.title`)}
        </h3>
        <p className="text-fg-muted text-base" style={{ lineHeight: 1.55 }}>
          {t(`tagline.pillars.${pillarKey}.description`)}
        </p>
      </div>
    </motion.div>
  );
}
