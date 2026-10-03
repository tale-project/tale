import { LogoCloudSection } from '@tale/marketing-ui/logo-cloud-section';
import { Card } from '@tale/ui/card';

import { INTEGRATION_LOGOS } from '@/app/content/connectors';
import { useT } from '@/lib/i18n/client';

export function ConnectorsBar() {
  const { t } = useT('home');
  const { t: tCompanies } = useT('companies');

  return (
    <LogoCloudSection
      title={t('connectors.title')}
      description={t('connectors.subtitle')}
      pad="xl"
      gapClassName="gap-10 md:gap-12"
    >
      <ul
        role="list"
        aria-label={t('connectors.title')}
        className="flex w-full flex-wrap justify-center gap-3 sm:gap-4"
      >
        {INTEGRATION_LOGOS.map(({ Icon, name, companyKey }) => (
          <Card
            key={name}
            asChild
            padding="sm"
            radius="xl"
            className="bg-surface-site-raised shadow-site-card w-24 sm:w-28 lg:w-32"
          >
            <li className="flex flex-col items-center gap-3">
              <Icon className="size-8 sm:size-9" aria-hidden />
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
    </LogoCloudSection>
  );
}
