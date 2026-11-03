import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';

import { useMeta } from '@/app/hooks/use-meta';
import type { Meta } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { InfoList, InfoRow } from './settings-info-list';
import { SettingsSection } from './settings-section';

// Stand-ins the loading mask is cut from, about as wide as the real values;
// they are never read.
const PLACEHOLDER = {
  version: '0.0.0',
  browser: 'Camoufox 000.0.0',
  installed: 'Yes',
};

/** The versions of the app and of its browser, and whether the browser is installed. */
export function AboutSection() {
  const { t } = useT('settings');
  const meta = useMeta();
  const loading = meta.data === undefined && !meta.isError;
  const unavailable = t('general.about.unavailable');

  const installed = (data: Meta) => {
    if (data.browserInstalled) return t('general.about.installedYes');
    return data.browserInstalling
      ? t('general.about.installing')
      : t('general.about.installedNo');
  };

  return (
    <SettingsSection title={t('general.about.title')}>
      <Skeletonize loading={loading}>
        <InfoList>
          <InfoRow label={t('general.about.version')}>
            <SkeletonBox>
              {loading
                ? PLACEHOLDER.version
                : (meta.data?.version ?? unavailable)}
            </SkeletonBox>
          </InfoRow>
          <InfoRow label={t('general.about.browser')}>
            <SkeletonBox>
              {loading
                ? PLACEHOLDER.browser
                : meta.data
                  ? t('general.about.browserBuild', {
                      version: meta.data.browserVersion,
                    })
                  : unavailable}
            </SkeletonBox>
          </InfoRow>
          <InfoRow label={t('general.about.installed')}>
            <SkeletonBox>
              {loading
                ? PLACEHOLDER.installed
                : meta.data
                  ? installed(meta.data)
                  : unavailable}
            </SkeletonBox>
          </InfoRow>
        </InfoList>
      </Skeletonize>
    </SettingsSection>
  );
}
