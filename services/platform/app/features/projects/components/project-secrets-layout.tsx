import { Alert } from '@tale/ui/alert';
import { EnvVarListEditor } from '@tale/ui/env-var-list-editor';
import { ShieldAlert } from 'lucide-react';
import type { ReactNode, Ref } from 'react';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { SettingsTabPage } from '@/app/features/settings/components/settings-tab-page';
import { useT } from '@/lib/i18n/client';

/**
 * The Environment tab's frame, shared by the tab and its chunk's fallback so
 * nothing shifts when the editor arrives: one settings section on the general
 * settings page (#2794). The section is titled like the tab, so its heading is
 * there for assistive tech and its description leads under the tab strip. A
 * `banner` (the archived notice) stands above the section, as on General.
 */
export function ProjectSecretsLayout({
  banner,
  sectionRef,
  children,
}: {
  banner?: ReactNode;
  /** Where the focus goes when a notice inside the section that held it leaves. */
  sectionRef?: Ref<HTMLElement>;
  children: ReactNode;
}) {
  const { t } = useT('projectSecrets');
  return (
    <SettingsTabPage title={t('title')}>
      {banner}
      <SettingsSection
        ref={sectionRef}
        tabIndex={-1}
        className="outline-none"
        title={t('title')}
        description={t('description')}
      >
        <Alert
          variant="warning"
          icon={ShieldAlert}
          title={t('agentAccessTitle')}
          description={t('agentAccessBody')}
        />
        {children}
      </SettingsSection>
    </SettingsTabPage>
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
