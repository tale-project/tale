import { Alert } from '@tale/ui/alert';
import { Text } from '@tale/ui/text';

import { useT } from '@/lib/i18n/client';

import { useSettings } from '../hooks/use-settings';
import { AiAccessSwitch } from './ai-access-switch';
import { ConnectInstructions } from './connect-instructions';
import { SettingsSection } from './settings-section';
import { ToolGroups } from './tool-groups';

/**
 * Settings > AI access: whether assistants may connect, and, once they may, how
 * to connect one and which tools they get. The warning stands whether the
 * switch is on or off: it is read before the person turns the access on.
 *
 * What follows the switch is shown for the SAVED value, not for where the
 * switch is going: a switch the server refuses, or settings not read yet (or
 * not readable), would otherwise flash an address that answers 403. Read the
 * setting again (the window coming back to the front, a change elsewhere) and
 * the page follows it.
 */
export function AiAccessPage() {
  const { t } = useT('settings');
  const enabled = useSettings().data?.mcpEnabled;

  return (
    <>
      <SettingsSection
        title={t('aiAccess.assistants.title')}
        description={t('aiAccess.assistants.description')}
        gap={6}
      >
        <AiAccessSwitch />
        <Alert
          variant="warning"
          // Always on the page, so it is not a live region announced on load.
          live="off"
          description={
            <>
              <strong className="text-foreground font-medium">
                {t('aiAccess.warning.lead')}
              </strong>{' '}
              {t('aiAccess.warning.detail')}
            </>
          }
        />
        {enabled === false && (
          <Text variant="muted">{t('aiAccess.off.description')}</Text>
        )}
      </SettingsSection>
      {enabled === true && (
        <>
          <ConnectInstructions />
          <SettingsSection
            title={t('aiAccess.tools.title')}
            description={t('aiAccess.tools.description')}
            gap={6}
          >
            <ToolGroups />
          </SettingsSection>
        </>
      )}
    </>
  );
}
