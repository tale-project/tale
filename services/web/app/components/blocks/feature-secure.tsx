import { Image } from '@tale/ui/image';
import { motion, useReducedMotion } from 'framer-motion';

import { SiteContainer } from '@/app/components/layout/site-container';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;

const FEATURES = [
  {
    key: 'chat',
    light: '/marketing/feature-chat.png',
    dark: '/marketing/feature-chat-dark.png',
  },
  {
    key: 'conversations',
    light: '/marketing/feature-conversations.png',
    dark: '/marketing/feature-conversations-dark.png',
  },
  {
    key: 'agents',
    light: '/marketing/feature-agents.png',
    dark: '/marketing/feature-agents-dark.png',
  },
  {
    key: 'automations',
    light: '/marketing/feature-automations.png',
    dark: '/marketing/feature-automations-dark.png',
  },
] as const;

export function FeatureSecure() {
  return (
    <section className="bg-bg-base scroll-mt-16 dark:bg-[#0f0f0f]">
      <SiteContainer>
        <div className="mx-auto max-w-280">
          {FEATURES.map((feature, index) => (
            <FeatureRow
              key={feature.key}
              featureKey={feature.key}
              light={feature.light}
              dark={feature.dark}
              index={index}
              isLast={index === FEATURES.length - 1}
            />
          ))}
        </div>
      </SiteContainer>
    </section>
  );
}

interface FeatureRowProps {
  featureKey: (typeof FEATURES)[number]['key'];
  light: string;
  dark: string;
  index: number;
  isLast: boolean;
}

function FeatureRow({
  featureKey,
  light,
  dark,
  index,
  isLast,
}: FeatureRowProps) {
  const { t } = useT('home');
  const reduceMotion = useReducedMotion();
  const stepLabel = `${String(index + 1).padStart(2, '0')} ${t(
    `featureSecure.${featureKey}.eyebrow`,
  )}`;

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-15%' }}
      transition={
        reduceMotion ? { duration: 0 } : { duration: 0.6, ease: easeOut }
      }
      className={`flex flex-col gap-12 py-10 md:gap-20 md:py-16 ${
        isLast ? '' : 'border-border-base border-b'
      }`}
    >
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2 md:items-start md:gap-20">
        <div className="flex flex-col gap-2">
          <p className="text-fg-subtle text-sm">{stepLabel}</p>
          <h3
            className="text-fg-base text-3xl font-medium whitespace-pre-line md:text-[48px]"
            style={{ letterSpacing: '-2.14px', lineHeight: 1.1 }}
          >
            {t(`featureSecure.${featureKey}.title`)}
          </h3>
        </div>
        <p
          className="text-fg-muted whitespace-pre-line md:max-w-125 md:text-lg"
          style={{ lineHeight: 1.5 }}
        >
          {t(`featureSecure.${featureKey}.description`)}
        </p>
      </div>
      <Image
        src={light}
        alt=""
        draggable={false}
        className="block h-auto w-full select-none dark:hidden"
        loading="lazy"
      />
      <Image
        src={dark}
        alt=""
        draggable={false}
        className="hidden h-auto w-full select-none dark:block"
        loading="lazy"
      />
    </motion.div>
  );
}
