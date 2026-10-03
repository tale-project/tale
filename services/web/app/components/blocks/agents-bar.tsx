import { PageSection } from '@/app/components/marketing';
import { AGENTS } from '@/app/content/agents';
import { useT } from '@/lib/i18n/client';

/** A quiet runtime strip beneath the product introduction. */
export function AgentsBar() {
  const { t } = useT('home');

  return (
    <PageSection pad="compact" border="b">
      <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,2fr)] lg:gap-12">
        <div className="max-w-sm">
          <h2 className="text-fg-base text-base font-medium tracking-tight">
            {t('agents.title')}
          </h2>
          <p className="text-fg-muted mt-2 text-sm leading-relaxed">
            {t('agents.subtitle')}
          </p>
        </div>
        <ul
          role="list"
          aria-label={t('agents.title')}
          className="grid grid-cols-4 gap-x-3 gap-y-6 sm:grid-cols-8"
        >
          {AGENTS.map((agent) => (
            <li
              key={agent.id}
              className="flex min-w-0 flex-col items-center gap-2 text-center"
            >
              <span
                className="text-fg-base flex h-7 w-full max-w-16 items-center justify-center"
                aria-hidden
              >
                <agent.Icon className={agent.wide ? 'h-5 w-full' : 'size-6'} />
              </span>
              <span className="text-fg-muted text-[11px] font-medium tracking-tight">
                {agent.name}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </PageSection>
  );
}
