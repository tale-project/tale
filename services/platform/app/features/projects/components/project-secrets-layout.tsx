import { Alert } from '@tale/ui/alert';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { EnvVarListEditor } from '@/app/components/env/env-var-list-editor';
import { ContentArea } from '@/app/components/layout/content-area';
import { useT } from '@/lib/i18n/client';

export function ProjectSecretsLayout({ children }: { children: ReactNode }) {
  const { t } = useT('projectSecrets');
  return (
    <ContentArea variant="narrow" gap={6}>
      <StickySectionHeader title={t('title')} description={t('description')} />
      <Alert
        variant="warning"
        icon={ShieldAlert}
        title={t('agentAccessTitle')}
        description={t('agentAccessBody')}
      />
      {children}
    </ContentArea>
  );
}

export function ProjectSecretsSkeleton() {
  return (
    <ProjectSecretsLayout>
      <EnvVarListEditor
        forceSecret
        rows={[]}
        isLoading
        onSet={async () => {}}
        onDelete={async () => {}}
      />
    </ProjectSecretsLayout>
  );
}
