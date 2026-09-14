import { MarketingButton } from '@tale/marketing-ui/button';
import { MarketingCard } from '@tale/marketing-ui/card';
import { MarketingPanel } from '@tale/marketing-ui/panel';
import { SectionHeading } from '@tale/marketing-ui/section-heading';
import { Blocks, Palette } from 'lucide-react';

/**
 * The marketing language, rendered inside a documentation page. Note the
 * different vocabulary: `surface-site` paper instead of `bg-background`,
 * weight-400 display type, pill buttons.
 */
export default function MarketingPrimitives() {
  return (
    <div className="bg-surface-site w-full rounded-lg p-6">
      <SectionHeading
        size="subsection"
        align="start"
        bare
        title="One system, two voices"
        description="The marketing package layers a page vocabulary on top of the app one."
      />
      <div className="mt-6 flex flex-wrap gap-3">
        <MarketingButton>Primary</MarketingButton>
        <MarketingButton tone="secondary">Secondary</MarketingButton>
      </div>
      <MarketingPanel className="mt-6 grid grid-cols-1 divide-y divide-[color:var(--color-border-base)] sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <MarketingCard
          reveal={false}
          icon={Palette}
          title="Tokens"
          description="Surfaces, ink and atmosphere, on top of the app tokens."
        />
        <MarketingCard
          reveal={false}
          icon={Blocks}
          title="Frames"
          description="Feature heroes, demo windows and comparison blocks."
        />
      </MarketingPanel>
    </div>
  );
}
