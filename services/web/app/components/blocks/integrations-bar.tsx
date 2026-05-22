import { motion, useReducedMotion } from 'framer-motion';
import type { ComponentType, SVGProps } from 'react';

import { GithubIcon } from '@/app/components/icons/github-icon';
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

const LOGOS: { Icon: BrandIcon; name: string }[] = [
  { Icon: OpenAIIcon, name: 'OpenAI' },
  { Icon: ShopifyIcon, name: 'Shopify' },
  { Icon: ClaudeIcon, name: 'Claude' },
  { Icon: GithubIcon, name: 'GitHub' },
  { Icon: MicrosoftIcon, name: 'Microsoft' },
  { Icon: SlackIcon, name: 'Slack' },
  { Icon: DiscordIcon, name: 'Discord' },
  { Icon: GmailIcon, name: 'Gmail' },
  { Icon: TavilyIcon, name: 'Tavily' },
];

export function IntegrationsBar() {
  const { t } = useT('home');
  const reduceMotion = useReducedMotion();

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
              {LOGOS.map(({ Icon, name }) => (
                <LogoTile key={`a-${name}`} Icon={Icon} name={name} />
              ))}
              {LOGOS.map(({ Icon, name }) => (
                <LogoTile
                  key={`b-${name}`}
                  Icon={Icon}
                  name={name}
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
  ariaHidden,
}: {
  Icon: BrandIcon;
  name: string;
  ariaHidden?: boolean;
}) {
  return (
    <span
      role={ariaHidden ? undefined : 'listitem'}
      aria-hidden={ariaHidden}
      aria-label={ariaHidden ? undefined : name}
      className="border-border-base text-fg-base flex size-18 shrink-0 items-center justify-center rounded-2xl border-[3px] bg-white dark:bg-[#0a0a0b]"
    >
      <Icon className="size-11" aria-hidden />
    </span>
  );
}
