// Subpath exports are the recommended import surface (see the exports map in
// package.json). This barrel exists only as a convenience for consumers that
// want a single import.

export { SiteContainer } from './components/site/site-container';
export { SiteFooter, type FooterColumn } from './components/site/site-footer';
export { SiteHeader } from './components/site/site-header';

export {
  CtaPair,
  MarketingButton,
  MarketingCard,
  MarketingExternalLink,
  MarketingLink,
  MarketingPanel,
  MarketingStack,
  PageSection,
  Reveal,
  SectionHeading,
  type CtaAction,
  type CtaPairProps,
  type MarketingCardProps,
  type MarketingLinkProps,
  type PageSectionProps,
} from './components/marketing';

export {
  MarketingRouterProvider,
  useMarketingLink,
  type MarketingLinkComponent,
  type MarketingLinkComponentProps,
} from './routing';

export { useSkipEntrance, withinEntranceWindow } from './lib/entrance';

export { DemoToolbar } from './components/demos/demo-chrome';
export { DemoShell } from './components/demos/demo-shell';
export { DemoStage } from './components/demos/demo-stage';
export { DemoStreamText } from './components/demos/demo-stream-text';
export {
  DemoTourRow,
  type DemoTourRowLink,
} from './components/demos/demo-tour-row';
export {
  DemoTourSection,
  type DemoTourStage,
} from './components/demos/demo-tour-section';
export { DemoTypingText } from './components/demos/demo-typing-text';
export { useDemoTimeline } from './components/demos/use-demo-timeline';

export { DocsLinks, type DocsLinkItem } from './components/feature/docs-links';
export {
  FeatureCapability,
  type FeatureCapabilityItem,
} from './components/feature/feature-capability';
export { FeatureCta } from './components/feature/feature-cta';
export {
  FeatureFaq,
  type FeatureFaqItem,
} from './components/feature/feature-faq';
export { FeatureHero } from './components/feature/feature-hero';
export { FeatureSteps } from './components/feature/feature-steps';
export {
  RelatedPages,
  type RelatedPageItem,
} from './components/feature/related-pages';

export {
  CompareTable,
  LabelWithInfo,
  type CompareDataRow,
  type CompareRow,
  type CompareSectionRow,
  type CompareSpanRow,
  type CompareTier,
} from './components/blocks/compare-table';
export { LogoCloudSection } from './components/blocks/logo-cloud-section';
export { MarketingSection } from './components/blocks/marketing-section';
export { ProgressBar } from './components/blocks/progress-bar';
export { SegmentedRadio } from './components/blocks/segmented-radio';
export { TierCard } from './components/blocks/tier-card';
