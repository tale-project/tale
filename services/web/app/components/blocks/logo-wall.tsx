import { AtlassianIcon } from '@/app/components/icons/atlassian-icon';
import { GoogleIcon } from '@/app/components/icons/google-icon';
import { MicrosoftIcon } from '@/app/components/icons/microsoft-icon';
import { SiteContainer } from '@/app/components/layout/site-container';
import { useT } from '@/lib/i18n/client';

export function LogoWall() {
  const { t } = useT('home');

  return (
    <section className="border-border-base border-b py-12">
      <SiteContainer>
        <p
          className="text-fg-muted flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-center text-base"
          style={{ letterSpacing: '-0.24px' }}
        >
          <span>{t('logoWall.prefix')}</span>
          <span className="inline-flex items-center gap-4">
            <MicrosoftIcon className="h-6 w-6" />
            <GoogleIcon className="h-6 w-6" />
            <AtlassianIcon className="h-6 w-6" />
          </span>
          <span>{t('logoWall.suffix')}</span>
        </p>
      </SiteContainer>
    </section>
  );
}
