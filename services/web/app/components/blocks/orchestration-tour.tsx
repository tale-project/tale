import { motion } from 'framer-motion';
import type { ComponentType } from 'react';

import { AutomationRun } from '@/app/components/blocks/demos/automation-run';
import { ConnectAgents } from '@/app/components/blocks/demos/connect-agents';
import { GovernGate } from '@/app/components/blocks/demos/govern-gate';
import { KnowledgePool } from '@/app/components/blocks/demos/knowledge-pool';
import { SiteContainer } from '@/app/components/layout/site-container';
import { useT } from '@/lib/i18n/client';
import { useSkipEntrance } from '@/lib/motion/entrance';

const easeOut: readonly [number, number, number, number] = [0.22, 1, 0.36, 1];

type StageKey = 'connect' | 'pool' | 'delegate' | 'govern';

// The journey the homepage tells: connect what you use, pool what you
// know, delegate the work, govern the result — one animated demo per stage.
const STAGES: readonly { key: StageKey; Demo: ComponentType }[] = [
  { key: 'connect', Demo: ConnectAgents },
  { key: 'pool', Demo: KnowledgePool },
  { key: 'delegate', Demo: AutomationRun },
  { key: 'govern', Demo: GovernGate },
];

export function OrchestrationTour() {
  const { t } = useT('home');
  const skipEntrance = useSkipEntrance();

  return (
    <section className="bg-surface-site scroll-mt-16">
      <SiteContainer>
        <div className="mx-auto max-w-280">
          <motion.div
            initial={skipEntrance ? false : { opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-15%' }}
            transition={
              skipEntrance ? { duration: 0 } : { duration: 0.6, ease: easeOut }
            }
            className="mx-auto flex max-w-180 flex-col items-center gap-3 pt-14 text-center md:pt-20"
          >
            <h2
              className="text-fg-base text-4xl font-medium md:text-[52px]"
              style={{ letterSpacing: '-2.14px', lineHeight: 1.077 }}
            >
              {t('tour.title')}
            </h2>
            <p
              className="text-fg-muted max-w-132 text-base md:text-lg"
              style={{ letterSpacing: '-0.108px', lineHeight: 1.556 }}
            >
              {t('tour.subtitle')}
            </p>
          </motion.div>

          {STAGES.map((stage, index) => (
            <TourRow
              key={stage.key}
              stageKey={stage.key}
              Demo={stage.Demo}
              index={index}
              isLast={index === STAGES.length - 1}
            />
          ))}
        </div>
      </SiteContainer>
    </section>
  );
}

function TourRow({
  stageKey,
  Demo,
  index,
  isLast,
}: {
  stageKey: StageKey;
  Demo: ComponentType;
  index: number;
  isLast: boolean;
}) {
  const { t } = useT('home');
  const skipEntrance = useSkipEntrance();
  const stepLabel = `${String(index + 1).padStart(2, '0')} ${t(
    `tour.${stageKey}.eyebrow`,
  )}`;

  return (
    <motion.div
      initial={skipEntrance ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-15%' }}
      transition={
        skipEntrance ? { duration: 0 } : { duration: 0.6, ease: easeOut }
      }
      className={`flex flex-col gap-10 py-10 md:gap-14 md:py-16 ${
        isLast ? '' : 'border-border-base border-b'
      }`}
    >
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2 md:items-start md:gap-20">
        <div className="flex flex-col gap-2">
          <p className="text-brand-base text-sm font-medium">{stepLabel}</p>
          <h3
            className="text-fg-base text-3xl font-medium whitespace-pre-line md:text-[48px]"
            style={{ letterSpacing: '-2.14px', lineHeight: 1.1 }}
          >
            {t(`tour.${stageKey}.title`)}
          </h3>
        </div>
        <p
          className="text-fg-muted whitespace-pre-line md:max-w-125 md:text-lg"
          style={{ lineHeight: 1.5 }}
        >
          {t(`tour.${stageKey}.description`)}
        </p>
      </div>
      <div className="bg-surface-wash rounded-2xl p-2 sm:rounded-3xl sm:p-4 md:p-8">
        <Demo />
      </div>
    </motion.div>
  );
}
