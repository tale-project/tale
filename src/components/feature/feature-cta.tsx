import {
  type CtaAction,
  CtaPair,
  MarketingStack,
  PageSection,
  SectionHeading,
} from '../marketing';

interface FeatureCtaProps {
  title: string;
  description?: string;
  /** Ink primary action. */
  primary: CtaAction;
  /** Inset secondary action. */
  secondary: CtaAction;
}

/** Closing CTA band on the soft paper→wash gradient — heading + two actions. */
export function FeatureCta({
  title,
  description,
  primary,
  secondary,
}: FeatureCtaProps) {
  return (
    <PageSection surface="soft" pad="lg" border="none">
      <MarketingStack max="sm" gap="md">
        <SectionHeading
          size="subsection"
          as="h2"
          title={title}
          description={description}
        />
        <CtaPair primary={primary} secondary={secondary} />
      </MarketingStack>
    </PageSection>
  );
}
