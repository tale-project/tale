import {
  buildBreadcrumbListJsonLd,
  buildFaqPageJsonLd,
} from '@tale/ui/seo/builders/json-ld';
import type { ReactNode } from 'react';
import { useMemo } from 'react';

import {
  HubHeroDemo,
  HubTourAgentsDemo,
  HubTourArenaDemo,
  HubTourAutomationsDemo,
  HubTourGovernDemo,
  HubTourKnowledgeDemo,
  HubTourProjectsDemo,
} from '@/app/components/blocks/demos/content';
import { DemoTourSection } from '@/app/components/blocks/demos/demo-tour-section';
import {
  FeatureCta,
  FeatureFaq,
  FeatureHero,
} from '@/app/components/blocks/feature';
import type { LocalizedRoutePath } from '@/app/components/layout/localized-link';
import {
  MarketingCard,
  MarketingPanel,
  MarketingStack,
  PageSection,
  SectionHeading,
} from '@/app/components/marketing';
import { PLATFORM_PAGES, getPlatformIcon } from '@/app/content/platform-pages';
import { useT } from '@/lib/i18n/client';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';
import { absoluteLocalizedUrl } from '@/lib/seo/absolute-url';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

interface FaqItem {
  q: string;
  a: string;
}

/**
 * Platform hub — hero demo → module sampler (each DemoShell row previews one
 * module page's own story and links to it) → module grid → FAQ → CTA.
 */
export function PlatformHubPage() {
  const { t } = useT('platformHub');
  const { t: tSeo } = useT('seo');
  const { t: tNav } = useT('nav');
  const { t: tHome } = useT('home');
  const locale = useCurrentLocale();

  const modules = PLATFORM_PAGES.filter((p) => p.id !== 'hub');
  const faq = t('faq.items', { returnObjects: true }) as FaqItem[];

  const tourStagesRaw = t('tour.stages', { returnObjects: true }) as
    | {
        id: string;
        eyebrow: string;
        title: string;
        description: string;
      }[]
    | string;

  // Module sampler: each hub window tells a hub-owned story for that module
  // (not the homepage and not a copy of the feature page) and deep-links in.
  const stageById: Record<
    string,
    { demo: ReactNode; moduleTo?: LocalizedRoutePath; moduleNavKey?: string }
  > = {
    agents: {
      demo: <HubTourAgentsDemo />,
      moduleTo: '/platform/agents',
      moduleNavKey: 'agents',
    },
    knowledge: {
      demo: <HubTourKnowledgeDemo />,
      moduleTo: '/platform/knowledge',
      moduleNavKey: 'knowledge',
    },
    automations: {
      demo: <HubTourAutomationsDemo />,
      moduleTo: '/platform/automations',
      moduleNavKey: 'automations',
    },
    govern: {
      demo: <HubTourGovernDemo />,
      moduleTo: '/platform/governance',
      moduleNavKey: 'governance',
    },
    arena: {
      demo: <HubTourArenaDemo />,
      moduleTo: '/platform/chat',
      moduleNavKey: 'chat',
    },
    projects: {
      demo: <HubTourProjectsDemo />,
      moduleTo: '/platform/projects',
      moduleNavKey: 'projects',
    },
  };

  const tourStages = Array.isArray(tourStagesRaw)
    ? tourStagesRaw.flatMap((stage, index) => {
        const entry = stageById[stage.id];
        if (!entry) return [];
        return [
          {
            id: stage.id,
            eyebrow: `${String(index + 1).padStart(2, '0')} ${stage.eyebrow}`,
            title: stage.title,
            description: stage.description,
            link:
              entry.moduleTo && entry.moduleNavKey
                ? {
                    label: tHome('tour.explore', {
                      module: tNav(`product.${entry.moduleNavKey}.label`),
                    }),
                    to: entry.moduleTo,
                  }
                : undefined,
            demo: entry.demo,
          },
        ];
      })
    : [];

  const jsonLd = useMemo(
    () => [
      buildBreadcrumbListJsonLd([
        { name: 'Tale', url: absoluteLocalizedUrl(locale, '/') },
        {
          name: tNav('product.hub.label'),
          url: absoluteLocalizedUrl(locale, '/platform'),
        },
      ]),
      buildFaqPageJsonLd(
        faq.map((item) => ({ question: item.q, answer: item.a })),
      ),
    ],
    [faq, locale, tNav],
  );

  useDocumentMeta({
    title: tSeo('platform.title'),
    description: tSeo('platform.description'),
    path: '/platform',
    jsonLd,
  });

  return (
    <>
      <FeatureHero
        title={t('title')}
        description={t('description')}
        visual={<HubHeroDemo />}
      />
      <DemoTourSection
        heading={t('tour.heading')}
        description={t('tour.description')}
        stages={tourStages}
      />
      <PageSection pad="lg" border="b">
        <MarketingStack max="xl" gap="xl" align="stretch">
          <SectionHeading
            size="section"
            title={t('modulesHeading')}
            description={t('modulesDescription')}
            align="start"
          />
          <MarketingPanel>
            <ul
              role="list"
              className="bg-border-base grid gap-px sm:grid-cols-2 lg:grid-cols-3"
            >
              {modules.map((page) => (
                <li key={page.id} className="bg-surface-site-raised">
                  <MarketingCard
                    to={page.path}
                    title={tNav(`product.${page.navKey}.label`)}
                    description={tNav(`product.${page.navKey}.description`)}
                    icon={getPlatformIcon(page.id)}
                    className="h-full"
                    reveal={false}
                  />
                </li>
              ))}
            </ul>
          </MarketingPanel>
        </MarketingStack>
      </PageSection>
      <FeatureFaq
        heading={t('faq.heading')}
        items={faq.map((f) => ({ question: f.q, answer: f.a }))}
      />
      <FeatureCta />
    </>
  );
}
