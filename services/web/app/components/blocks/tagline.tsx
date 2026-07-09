import { Image } from '@tale/ui/image';
import { motion } from 'framer-motion';

import { SiteContainer } from '@/app/components/layout/site-container';
import { useT } from '@/lib/i18n/client';
import { useSkipEntrance } from '@/lib/motion/entrance';

const easeOut = [0.22, 1, 0.36, 1] as const;

const PILLARS = [
  {
    key: 'selfHosted',
    light: '/marketing/feature-self-hosted.svg',
    dark: '/marketing/feature-self-hosted-dark.svg',
  },
  {
    key: 'security',
    light: '/marketing/feature-security.svg',
    dark: '/marketing/feature-security-dark.svg',
  },
  {
    key: 'openSource',
    light: '/marketing/feature-open-source.svg',
    dark: '/marketing/feature-open-source-dark.svg',
  },
] as const;

export function Tagline() {
  const { t } = useT('home');
  const skipEntrance = useSkipEntrance();

  return (
    <section className="border-border-base bg-surface-site border-b pt-20 pb-20">
      <SiteContainer>
        <motion.div
          initial={skipEntrance ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-15%' }}
          transition={
            skipEntrance ? { duration: 0 } : { duration: 0.6, ease: easeOut }
          }
          className="mx-auto flex max-w-180 flex-col items-center gap-3 text-center"
        >
          <h2
            className="text-fg-base text-4xl font-medium md:text-[52px]"
            style={{ letterSpacing: '-2.14px', lineHeight: 1.077 }}
          >
            {t('tagline.title')}
          </h2>
          <p
            className="text-fg-muted max-w-132 text-base md:text-lg"
            style={{ letterSpacing: '-0.108px', lineHeight: 1.556 }}
          >
            {t('tagline.subtitle')}
          </p>
        </motion.div>
      </SiteContainer>

      <div className="mx-auto mt-12 w-full max-w-7xl md:px-20">
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
              light={pillar.light}
              dark={pillar.dark}
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
  light: string;
  dark: string;
  showLeftBorder: boolean;
  skipEntrance: boolean;
}

const pillarVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: easeOut },
  },
};

function PillarCard({
  pillarKey,
  light,
  dark,
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
      <div className="bg-surface-site-inset flex h-75 items-center justify-center overflow-hidden">
        <Image
          src={light}
          alt=""
          draggable={false}
          className="block h-full w-full object-contain select-none dark:hidden"
          loading="lazy"
        />
        <Image
          src={dark}
          alt=""
          draggable={false}
          className="hidden h-full w-full object-contain select-none dark:block"
          loading="lazy"
        />
      </div>
      <div className="flex flex-col gap-3 px-6 py-8 md:px-10">
        <h3
          className="text-fg-base text-xl font-medium"
          style={{ letterSpacing: '-1px' }}
        >
          {t(`tagline.pillars.${pillarKey}.title`)}
        </h3>
        <p className="text-fg-muted text-base" style={{ lineHeight: 1.55 }}>
          {t(`tagline.pillars.${pillarKey}.description`)}
        </p>
      </div>
    </motion.div>
  );
}
