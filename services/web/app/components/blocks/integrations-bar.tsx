import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@tale/ui/tooltip';
import { motion, useReducedMotion } from 'framer-motion';
import type { ComponentType, SVGProps } from 'react';

import { AtlassianIcon } from '@/app/components/icons/atlassian-icon';
import { GithubIcon } from '@/app/components/icons/github-icon';
import { GoogleIcon } from '@/app/components/icons/google-icon';
import {
  ClaudeIcon,
  DiscordIcon,
  GmailIcon,
  OpenAIIcon,
  ShopifyIcon,
  SlackIcon,
  TavilyIcon,
} from '@/app/components/icons/integration-icons';
import { MicrosoftIcon } from '@/app/components/icons/microsoft-icon';
import { SiteContainer } from '@/app/components/layout/site-container';
import { useT } from '@/lib/i18n/client';

const easeOut = [0.22, 1, 0.36, 1] as const;

type BrandIcon = ComponentType<
  SVGProps<SVGSVGElement> & { className?: string }
>;

interface LogoEntry {
  Icon: BrandIcon;
  name: string;
  /**
   * Optional `companies.*` key in `global.json`. When set, the tooltip
   * shows the full legal company name instead of the short brand label —
   * used for parent companies whose product portfolio isn't obvious from
   * the logo alone (Microsoft, Google, Atlassian).
   */
  companyKey?: 'microsoft' | 'google' | 'atlassian';
}

const LOGOS: LogoEntry[] = [
  { Icon: OpenAIIcon, name: 'OpenAI' },
  { Icon: ShopifyIcon, name: 'Shopify' },
  { Icon: ClaudeIcon, name: 'Claude' },
  { Icon: GithubIcon, name: 'GitHub' },
  { Icon: MicrosoftIcon, name: 'Microsoft', companyKey: 'microsoft' },
  { Icon: GoogleIcon, name: 'Google', companyKey: 'google' },
  { Icon: AtlassianIcon, name: 'Atlassian', companyKey: 'atlassian' },
  { Icon: SlackIcon, name: 'Slack' },
  { Icon: DiscordIcon, name: 'Discord' },
  { Icon: GmailIcon, name: 'Gmail' },
  { Icon: TavilyIcon, name: 'Tavily' },
];

export function IntegrationsBar() {
  const { t } = useT('home');
  const { t: tCompanies } = useT('companies');
  const reduceMotion = useReducedMotion();

  const tooltipFor = (entry: LogoEntry) =>
    entry.companyKey ? tCompanies(entry.companyKey) : entry.name;

  return (
    <section className="border-border-base border-t bg-white py-16 md:py-20 dark:bg-[#0f0f0f]">
      <SiteContainer>
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-15%' }}
          transition={
            reduceMotion ? { duration: 0 } : { duration: 0.6, ease: easeOut }
          }
          className="mx-auto flex max-w-280 flex-col items-center gap-16"
        >
          <div className="flex flex-col items-center gap-4 text-center">
            <h2
              className="text-fg-base text-3xl font-medium md:text-[48px]"
              style={{ letterSpacing: '-2.14px', lineHeight: 1.15 }}
            >
              {t('integrations.title')}
            </h2>
            <p
              className="text-fg-subtle max-w-150 text-base md:text-lg"
              style={{ lineHeight: 1.5 }}
            >
              {t('integrations.subtitle')}
            </p>
          </div>

          <div
            role="list"
            aria-label={t('integrations.title')}
            className="group w-full overflow-hidden mask-[linear-gradient(to_right,transparent,#000_10%,#000_90%,transparent)]"
          >
            <div
              className="marquee-track flex w-max items-center gap-6 group-hover:[animation-play-state:paused] md:gap-10"
              style={{ animation: 'marquee 40s linear infinite' }}
            >
              {LOGOS.map((entry) => (
                <LogoTile
                  key={`a-${entry.name}`}
                  Icon={entry.Icon}
                  name={entry.name}
                  tooltip={tooltipFor(entry)}
                />
              ))}
              {LOGOS.map((entry) => (
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
        </motion.div>
      </SiteContainer>
    </section>
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
            className="border-border-base text-fg-base focus-visible:ring-accent-base/30 flex size-18 shrink-0 cursor-default items-center justify-center rounded-2xl border-[3px] bg-white focus-visible:ring-2 focus-visible:outline-none dark:bg-[#0a0a0b]"
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
