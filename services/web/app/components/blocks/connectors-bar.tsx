import { PageSection } from '@tale/marketing-ui/page-section';
import { SectionHeading } from '@tale/marketing-ui/section-heading';
import { Card } from '@tale/ui/card';

import { INTEGRATION_LOGOS } from '@/app/content/connectors';
import { useT } from '@/lib/i18n/client';

export function ConnectorsBar() {
  const { t } = useT('home');
  const { t: tCompanies } = useT('companies');

  return (
    <PageSection pad="lg">
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
        <SectionHeading
          bare
          align="start"
          size="subsection"
          title={t('connectors.title')}
          description={t('connectors.subtitle')}
        />
        <ul
          role="list"
          aria-label={t('connectors.title')}
          className="flex w-full flex-wrap gap-2.5"
        >
          {INTEGRATION_LOGOS.map(({ Icon, name, companyKey }) => (
            <Card
              key={name}
              asChild
              padding="sm"
              radius="xl"
              className="bg-surface-site-raised w-auto"
            >
              <li className="flex items-center gap-2.5 px-3 py-2.5">
                <Icon className="size-5 shrink-0" aria-hidden />
                <span
                  className="text-fg-muted text-xs font-medium"
                  title={companyKey ? tCompanies(companyKey) : undefined}
                >
                  {name}
                </span>
              </li>
            </Card>
          ))}
        </ul>
      </div>
    </PageSection>
  );
}
