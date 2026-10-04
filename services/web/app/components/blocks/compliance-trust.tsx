import { Layers, ShieldCheck } from 'lucide-react';

import { TrustCertifications } from '@/app/components/blocks/trust-certifications';
import { PageSection, Reveal } from '@/app/components/marketing';
import { useT } from '@/lib/i18n/client';

const SUPPORT = [
  { key: 'independent', Icon: Layers },
  { key: 'certified', Icon: ShieldCheck },
] as const;

export function ComplianceTrust() {
  const { t } = useT('home');

  return (
    <PageSection pad="lg" surface="wash" border="none">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] lg:gap-14">
        <Reveal className="flex flex-col items-start gap-5">
          <p className="text-fg-subtle text-xs font-medium tracking-[0.12em] uppercase">
            {t('compliance.eyebrow')}
          </p>
          <h2 className="text-fg-base text-3xl leading-tight tracking-[-0.035em]">
            {t('compliance.title')}
          </h2>
          <TrustCertifications variant="badges" />
        </Reveal>
        {SUPPORT.map(({ key, Icon }) => (
          <Reveal
            key={key}
            className="border-border-base border-t pt-6 lg:border-t-0 lg:pt-0"
          >
            <Icon
              aria-hidden
              className="text-fg-muted mb-5 size-6"
              strokeWidth={1.5}
            />
            <h3 className="text-fg-base text-lg font-medium tracking-tight">
              {t(`compliance.${key}.title`)}
            </h3>
            <p className="text-fg-muted mt-3 text-sm leading-relaxed">
              {t(`compliance.${key}.description`)}
            </p>
          </Reveal>
        ))}
      </div>
    </PageSection>
  );
}
