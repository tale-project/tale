import {
  type CtaAction,
  CtaPair,
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
      <div className="flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-center lg:gap-16">
        <SectionHeading
          size="subsection"
          as="h2"
          align="start"
          className="max-w-2xl"
          title={title}
          description={description}
        />
        <CtaPair
          align="start"
          primary={primary}
          secondary={secondary}
          className="shrink-0"
        />
      </div>
    </PageSection>
  );
}
