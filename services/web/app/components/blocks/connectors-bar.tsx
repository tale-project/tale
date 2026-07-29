import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@tale/ui/tooltip';

import { LogoCloudSection } from '@/app/components/blocks/logo-cloud-section';
import type { BrandIcon } from '@/app/components/icons/types';
import {
  INTEGRATION_LOGOS,
  type ConnectorLogo,
} from '@/app/content/connectors';
import { useT } from '@/lib/i18n/client';

export function ConnectorsBar() {
  const { t } = useT('home');
  const { t: tCompanies } = useT('companies');

  const tooltipFor = (entry: ConnectorLogo) =>
    entry.companyKey ? tCompanies(entry.companyKey) : entry.name;

  return (
    <LogoCloudSection
      title={t('connectors.title')}
      description={t('connectors.subtitle')}
      className="overflow-hidden"
      pad="xl"
      gapClassName="gap-16"
    >
      <div
        role="list"
        aria-label={t('connectors.title')}
        className="group relative h-18 w-full max-w-full overflow-hidden mask-[linear-gradient(to_right,transparent,#000_10%,#000_90%,transparent)]"
      >
        {/* Absolute track so the duplicated logo row never widens the
            document scrollport (mobile horizontal scroll). */}
        <div
          className="marquee-track absolute top-0 left-0 flex w-max items-center gap-6 group-hover:[animation-play-state:paused] md:gap-10"
          style={{ animation: 'marquee 40s linear infinite' }}
        >
          {INTEGRATION_LOGOS.map((entry) => (
            <LogoTile
              key={`a-${entry.name}`}
              Icon={entry.Icon}
              name={entry.name}
              tooltip={tooltipFor(entry)}
            />
          ))}
          {INTEGRATION_LOGOS.map((entry) => (
            <LogoTile
              key={`b-${entry.name}`}
              Icon={entry.Icon}
              name={entry.name}
              tooltip={tooltipFor(entry)}
              ariaHidden
            />
          ))}
        </div>
      </div>
    </LogoCloudSection>
  );
}

function LogoTile({
  Icon,
  name,
  tooltip,
  ariaHidden,
}: {
  Icon: BrandIcon;
  name: string;
  tooltip: string;
  ariaHidden?: boolean;
}) {
  // Each tile owns its own TooltipProvider so the trigger gets a fresh
  // Radix root — without it, the marquee's clones (which share an outer
  // provider) intermittently miss pointer events.
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            role={ariaHidden ? undefined : 'listitem'}
            aria-hidden={ariaHidden}
            aria-label={ariaHidden ? undefined : tooltip}
            tabIndex={ariaHidden ? -1 : 0}
            className="border-border-base text-fg-base focus-visible:ring-fg-base/25 bg-surface-site-raised shadow-site-card hover:shadow-site-card-hover flex size-18 shrink-0 cursor-default items-center justify-center rounded-xl border transition-shadow duration-200 focus-visible:ring-2 focus-visible:outline-none"
          >
            <Icon className="size-11" aria-hidden />
            <span className="sr-only">{name}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
