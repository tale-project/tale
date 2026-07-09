import type { ComponentType } from 'react';

import {
  HomeArenaDemo,
  HomeAutomationDemo,
  HomeConnectDemo,
  HomeGovernDemo,
  HomeKnowledgeDemo,
  HomeProjectsDemo,
} from '@/app/components/blocks/demos/content';
import { DemoTourSection } from '@/app/components/blocks/demos/demo-tour-section';
import type { LocalizedRoutePath } from '@/app/components/layout/localized-link';
import { useT } from '@/lib/i18n/client';

type StageKey =
  | 'connect'
  | 'pool'
  | 'delegate'
  | 'govern'
  | 'arena'
  | 'projects';

/** Each stage deep-links to the module page whose story it previews. */
const STAGES: readonly {
  key: StageKey;
  Demo: ComponentType;
  moduleTo?: LocalizedRoutePath;
  moduleNavKey?: string;
}[] = [
  {
    key: 'connect',
    Demo: HomeConnectDemo,
    moduleTo: '/platform/agents',
    moduleNavKey: 'agents',
  },
  {
    key: 'pool',
    Demo: HomeKnowledgeDemo,
    moduleTo: '/platform/knowledge',
    moduleNavKey: 'knowledge',
  },
  {
    key: 'delegate',
    Demo: HomeAutomationDemo,
    moduleTo: '/platform/automations',
    moduleNavKey: 'automations',
  },
  {
    key: 'govern',
    Demo: HomeGovernDemo,
    moduleTo: '/platform/governance',
    moduleNavKey: 'governance',
  },
  {
    key: 'arena',
    Demo: HomeArenaDemo,
    moduleTo: '/platform/chat',
    moduleNavKey: 'chat',
  },
  { key: 'projects', Demo: HomeProjectsDemo },
];

/**
 * Homepage orchestration journey — thin wrapper over DemoTourSection with
 * home.tour.* copy and the six product demos.
 */
export function OrchestrationTour() {
  const { t } = useT('home');
  const { t: tNav } = useT('nav');

  return (
    <DemoTourSection
      heading={t('tour.title')}
      description={t('tour.subtitle')}
      stages={STAGES.map((stage, index) => ({
        id: stage.key,
        eyebrow: `${String(index + 1).padStart(2, '0')} ${t(
          `tour.${stage.key}.eyebrow`,
        )}`,
        title: t(`tour.${stage.key}.title`),
        description: t(`tour.${stage.key}.description`),
        link:
          stage.moduleTo && stage.moduleNavKey
            ? {
                label: t('tour.explore', {
                  module: tNav(`product.${stage.moduleNavKey}.label`),
                }),
                to: stage.moduleTo,
              }
            : undefined,
        demo: <stage.Demo />,
      }))}
    />
  );
}
