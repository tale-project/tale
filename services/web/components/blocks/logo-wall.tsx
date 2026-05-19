import { AtlassianIcon } from '@/components/icons/atlassian-icon';
import { GoogleIcon } from '@/components/icons/google-icon';
import { MicrosoftIcon } from '@/components/icons/microsoft-icon';
import { SiteContainer } from '@/components/layout/site-container';
import { useT } from '@/lib/i18n/client';

export function LogoWall() {
  const { t } = useT('home');

  return (
    <section className="border-border-base border-b py-6 md:py-12">
      <SiteContainer>
        <p
          className="text-fg-muted flex flex-col items-center justify-center gap-3 text-center text-sm md:flex-row md:flex-wrap md:gap-x-4 md:gap-y-2 md:text-base"
          style={{ letterSpacing: '-0.24px' }}
        >
          <span>{t('logoWall.prefix')}</span>
          <span className="inline-flex items-center gap-6">
            <MicrosoftIcon className="h-6 w-6" aria-hidden="true" />
            <GoogleIcon className="h-6 w-6" aria-hidden="true" />
            <AtlassianIcon className="h-6 w-6" aria-hidden="true" />
          </span>
          <span>{t('logoWall.suffix')}</span>
        </p>
      </SiteContainer>
    </section>
  );
}
