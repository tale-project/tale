import type { ReactNode } from 'react';

import type { DemoTourStage } from '@/app/components/blocks/demos/demo-tour-section';
import { useT } from '@/lib/i18n/client';

type FeatureNamespace =
  | 'platformAgents'
  | 'platformChat'
  | 'platformProjects'
  | 'platformAutomations'
  | 'platformKnowledge'
  | 'platformGovernance';

interface TourStageCopy {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
}

/**
 * Loads homepage-style tour copy from `platform*.tour` and pairs each stage
 * with its already-rendered DemoShell scene (so pages can pass per-page
 * scenarios into the shared demo components).
 */
export function usePlatformTour(
  namespace: FeatureNamespace,
  demos: readonly { id: string; demo: ReactNode }[],
): {
  tourHeading?: string;
  tourDescription?: string;
  tourStages: readonly DemoTourStage[];
} {
  const { t } = useT(namespace);

  const heading = t('tour.heading');
  const descriptionRaw = t('tour.description');
  const stagesRaw = t('tour.stages', { returnObjects: true }) as
    | TourStageCopy[]
    | string;

  const copyById = new Map<string, TourStageCopy>();
  if (Array.isArray(stagesRaw)) {
    for (const stage of stagesRaw) {
      copyById.set(stage.id, stage);
    }
  }

  const tourStages: DemoTourStage[] = demos.flatMap((entry, index) => {
    const copy = copyById.get(entry.id);
    if (!copy) return [];
    return [
      {
        id: entry.id,
        eyebrow: `${String(index + 1).padStart(2, '0')} ${copy.eyebrow}`,
        title: copy.title,
        description: copy.description,
        demo: entry.demo,
      },
    ];
  });

  return {
    tourHeading: heading && heading !== 'tour.heading' ? heading : undefined,
    tourDescription:
      descriptionRaw && descriptionRaw !== 'tour.description'
        ? descriptionRaw
        : undefined,
    tourStages,
  };
}
