import type { PlatformPageId } from '@/app/content/platform-pages';
import type { FeaturePageContent } from '@/app/pages/platform/feature-page-layout';
import { DOCS_URL } from '@/lib/docs-url';
import { useT } from '@/lib/i18n/client';

type FeatureNamespace =
  | 'platformAgents'
  | 'platformChat'
  | 'platformProjects'
  | 'platformAutomations'
  | 'platformKnowledge'
  | 'platformGovernance';

interface CapItem {
  title: string;
  body: string;
  docsLabel?: string;
}

interface FaqItem {
  q: string;
  a: string;
}

interface DocsItem {
  label: string;
  path: string;
}

/**
 * Maps a feature i18n namespace into FeaturePageLayout content (copy only).
 * Tour stages and hero demos are wired by each page via usePlatformTour.
 */
export function useFeaturePageContent(
  pageId: Exclude<PlatformPageId, 'hub'>,
  namespace: FeatureNamespace,
): Omit<
  FeaturePageContent,
  'visual' | 'tourHeading' | 'tourDescription' | 'tourStages'
> {
  const { t } = useT(namespace);

  const capabilities = t('capabilities.items', {
    returnObjects: true,
  }) as CapItem[];
  const faq = t('faq.items', { returnObjects: true }) as FaqItem[];
  const docs = t('docs', { returnObjects: true }) as DocsItem[];

  const capsDescription = t('capabilities.description');

  return {
    pageId,
    eyebrow: t('eyebrow'),
    title: t('title'),
    description: t('description'),
    capabilitiesHeading: t('capabilities.heading'),
    capabilitiesDescription:
      capsDescription && capsDescription !== 'capabilities.description'
        ? capsDescription
        : undefined,
    capabilities: capabilities.map((item) => {
      const docsMatch = item.docsLabel
        ? docs.find((d) => d.label === item.docsLabel)
        : undefined;
      return {
        title: item.title,
        body: item.body,
        docsLabel: item.docsLabel,
        docsHref: docsMatch
          ? docsMatch.path.startsWith('http')
            ? docsMatch.path
            : `${DOCS_URL}${docsMatch.path}`
          : undefined,
      };
    }),
    faqHeading: t('faq.heading'),
    faq: faq.map((item) => ({
      question: item.q,
      answer: item.a,
    })),
    docsLinks: docs.map((item) => ({
      label: item.label,
      href: item.path.startsWith('http')
        ? item.path
        : `${DOCS_URL}${item.path}`,
    })),
  };
}
