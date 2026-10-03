import { QuickstartTerminal } from '@/app/components/blocks/quickstart-terminal';
import {
  CtaPair,
  PageSection,
  Reveal,
  SectionHeading,
} from '@/app/components/marketing';
import { GET_STARTED_HREF, REQUEST_DEMO_PATH } from '@/app/content/site-ctas';
import { useT } from '@/lib/i18n/client';

export function CtaDeploy() {
  const { t } = useT('home');

  return (
    <PageSection
      surface="plain"
      pad="xl"
      border="t"
      className="bg-gradient-site-cta relative overflow-hidden"
    >
      <Reveal className="grid items-center gap-10 text-left lg:grid-cols-2 lg:gap-20">
        <div className="flex min-w-0 flex-col items-start gap-8">
          <SectionHeading
            bare
            align="start"
            title={t('cta.title')}
            description={t('cta.description')}
          />
          <CtaPair
            align="start"
            primary={{ label: t('cta.getStarted'), href: GET_STARTED_HREF }}
            secondary={{ label: t('cta.primary'), to: REQUEST_DEMO_PATH }}
          />
        </div>
        <QuickstartTerminal
          title={t('cta.terminalTitle')}
          copyLabel={t('cta.copy')}
          copiedLabel={t('cta.copied')}
          docsLabel={t('cta.docsLink')}
        />
      </Reveal>
    </PageSection>
  );
}
