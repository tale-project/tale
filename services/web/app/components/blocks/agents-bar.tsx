import { LogoCloudSection } from '@/app/components/blocks/logo-cloud-section';
import { AGENTS } from '@/app/content/agents';
import { useT } from '@/lib/i18n/client';

/** Homepage strip — which coding agents Tale works with. */
export function AgentsBar() {
  const { t } = useT('home');

  return (
    <LogoCloudSection
      title={t('agents.title')}
      description={t('agents.subtitle')}
      className="bg-surface-site-raised"
      pad="xl"
      dense
      gapClassName="gap-5 md:gap-6"
    >
      <ul
        role="list"
        aria-label={t('agents.title')}
        className="grid w-full max-w-5xl grid-cols-4 gap-x-3 gap-y-5 sm:gap-x-4 lg:grid-cols-8 lg:gap-x-5 lg:gap-y-0"
      >
        {AGENTS.map((agent) => (
          <li
            key={agent.id}
            className="flex flex-col items-center gap-1.5 text-center"
          >
            <span
              className={
                agent.wide
                  ? 'text-fg-base flex h-6 w-16 items-center justify-center sm:h-7 sm:w-20'
                  : 'text-fg-base flex size-6 items-center justify-center sm:size-7'
              }
              aria-hidden
            >
              <agent.Icon
                className={
                  agent.wide ? 'h-5 w-full sm:h-6' : 'size-5 sm:size-6'
                }
              />
            </span>
            <span className="text-fg-muted text-[11px] font-medium tracking-tight sm:text-xs">
              {agent.name}
            </span>
          </li>
        ))}
      </ul>
    </LogoCloudSection>
  );
}
