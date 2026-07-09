import {
  buildBreadcrumbListJsonLd,
  buildFaqPageJsonLd,
} from '@tale/ui/seo/builders/json-ld';
import type { ReactNode } from 'react';
import { useMemo } from 'react';

import {
  type DemoTourStage,
  DemoTourSection,
} from '@/app/components/blocks/demos/demo-tour-section';
import {
  DocsLinks,
  type DocsLinkItem,
  FeatureCapability,
  type FeatureCapabilityItem,
  FeatureCta,
  FeatureFaq,
  type FeatureFaqItem,
  FeatureHero,
  RelatedPages,
} from '@/app/components/blocks/feature';
import {
  type PlatformPageId,
  getPlatformPage,
} from '@/app/content/platform-pages';
import { useT } from '@/lib/i18n/client';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';
import { absoluteLocalizedUrl } from '@/lib/seo/absolute-url';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

export interface FeaturePageContent {
  pageId: PlatformPageId;
  eyebrow?: string;
  title: string;
  description: string;
  /** Primary lead demo (DemoShell scene on an inset DemoStage). */
  visual?: ReactNode;
  /** Homepage-style stacked tour rows (copy + DemoStage + DemoShell). */
  tourHeading?: string;
  tourDescription?: string;
  tourStages?: readonly DemoTourStage[];
  capabilitiesHeading: string;
  capabilitiesDescription?: string;
  capabilities: readonly FeatureCapabilityItem[];
  faqHeading: string;
  faq: readonly FeatureFaqItem[];
  docsLinks: readonly DocsLinkItem[];
  relatedIds?: readonly PlatformPageId[];
}

/**
 * Platform feature pages mirror the homepage narrative:
 * hero (+ demo) → product tour (alternating copy + demos) → capabilities
 * (docs-traceable claims) → mini-FAQ → related → docs → CTA.
 */
export function FeaturePageLayout({
  content,
}: {
  content: FeaturePageContent;
}) {
  const { t: tSeo } = useT('seo');
  const { t: tNav } = useT('nav');
  const locale = useCurrentLocale();
  const page = getPlatformPage(content.pageId);
  const hub = getPlatformPage('hub');

  const jsonLd = useMemo(() => {
    const nodes = [
      buildBreadcrumbListJsonLd([
        { name: 'Tale', url: absoluteLocalizedUrl(locale, '/') },
        {
          name: tNav(`product.${hub.navKey}.label`),
          url: absoluteLocalizedUrl(locale, hub.path),
        },
        {
          name: content.title,
          url: absoluteLocalizedUrl(locale, page.path),
        },
      ]),
    ];
    if (content.faq.length > 0) {
      nodes.push(
        buildFaqPageJsonLd(
          content.faq.map((item) => ({
            question: item.question,
            answer: item.answer,
          })),
        ),
      );
    }
    return nodes;
  }, [
    content.faq,
    content.title,
    hub.navKey,
    hub.path,
    locale,
    page.path,
    tNav,
  ]);

  useDocumentMeta({
    title: tSeo(`${page.seoKey}.title`),
    description: tSeo(`${page.seoKey}.description`),
    path: page.path,
    jsonLd,
  });

  return (
    <>
      <FeatureHero
        eyebrow={content.eyebrow}
        title={content.title}
        description={content.description}
        visual={content.visual}
      />
      {content.tourStages && content.tourStages.length > 0 ? (
        <DemoTourSection
          heading={content.tourHeading}
          description={content.tourDescription}
          stages={content.tourStages}
        />
      ) : null}
      <FeatureCapability
        heading={content.capabilitiesHeading}
        description={content.capabilitiesDescription}
        items={content.capabilities}
      />
      <FeatureFaq heading={content.faqHeading} items={content.faq} />
      <RelatedPages
        currentId={content.pageId}
        relatedIds={content.relatedIds ?? page.related}
      />
      <DocsLinks links={content.docsLinks} />
      <FeatureCta />
    </>
  );
}
