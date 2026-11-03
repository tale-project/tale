import { CodeBlock } from '@tale/ui/code-block';
import { CopyableField } from '@tale/ui/copyable-field';
import { ClaudeIcon } from '@tale/ui/icons/claude-icon';
import { Tabs, type TabItem } from '@tale/ui/tabs';
import { Text } from '@tale/ui/text';
import { useMemo, useState, type ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';

import {
  claudeCodeCommand,
  claudeDesktopConfig,
  mcpEndpoint,
  mcpJsonConfig,
} from '../lib/connection';
import { SettingsSection } from './settings-section';

// The shared block reveals its copy control on hover and focus, which a touch
// screen has neither of. This is a page whose point is to copy these: the
// control is always shown. A gap in the library (the block has no such option),
// reached by selector until it has one.
const COPY_CONTROL = '[&_button]:opacity-100';

const CLIENTS = ['claudeCode', 'cursor', 'claudeDesktop'] as const;
type Client = (typeof CLIENTS)[number];

function isClient(value: string): value is Client {
  return CLIENTS.some((client) => client === value);
}

/** The name of a client in its tab: Claude's own mark beside the two of Claude. */
function ClientName({
  children,
  claude,
}: {
  children: ReactNode;
  claude: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5">
      {claude ? <ClaudeIcon className="size-4" /> : null}
      {children}
    </span>
  );
}

/**
 * How to add the app to an assistant: its address, derived from where the page
 * is served from, and one setup at a time for the assistant the person picks,
 * as the platform lays out the connection of a coding agent: a row of the
 * assistants, and under the one chosen the sentence that says what to do and
 * the command or configuration to copy. The page shows it only while AI access
 * is on: the address answers 403 otherwise, and instructions that cannot work
 * are worse than none.
 */
export function ConnectInstructions() {
  const { t } = useT('settings');
  const url = mcpEndpoint(window.location.origin);
  const [client, setClient] = useState<Client>('claudeCode');

  const items = useMemo<TabItem[]>(() => {
    const setups: Record<
      Client,
      { name: string; step: string; text: string; copy: string }
    > = {
      claudeCode: {
        name: t('aiAccess.connect.clientClaudeCode'),
        step: t('aiAccess.connect.claudeCode'),
        text: claudeCodeCommand(url),
        copy: t('aiAccess.connect.copyCommand'),
      },
      cursor: {
        name: t('aiAccess.connect.clientCursor'),
        step: t('aiAccess.connect.cursor'),
        text: mcpJsonConfig(url),
        copy: t('aiAccess.connect.copyConfig'),
      },
      claudeDesktop: {
        name: t('aiAccess.connect.clientClaudeDesktop'),
        step: t('aiAccess.connect.claudeDesktop'),
        text: claudeDesktopConfig(url),
        copy: t('aiAccess.connect.copyConfig'),
      },
    };
    return CLIENTS.map((key) => {
      const setup = setups[key];
      return {
        value: key,
        label: <ClientName claude={key !== 'cursor'}>{setup.name}</ClientName>,
        content: (
          <div className="flex flex-col gap-3 pt-4">
            <Text>{setup.step}</Text>
            <CodeBlock
              copyValue={setup.text}
              copyLabel={setup.copy}
              className={COPY_CONTROL}
            >
              {setup.text}
            </CodeBlock>
          </div>
        ),
      };
    });
  }, [t, url]);

  return (
    <SettingsSection
      title={t('aiAccess.connect.title')}
      description={t('aiAccess.connect.description')}
      gap={6}
    >
      <CopyableField
        label={t('aiAccess.connect.address')}
        value={url}
        description={t('aiAccess.connect.addressHint')}
      />
      <Tabs
        items={items}
        value={client}
        onValueChange={(value) => {
          if (isClient(value)) setClient(value);
        }}
        listAriaLabel={t('aiAccess.connect.clients')}
        // On a phone the three names do not fit side by side: the row wraps,
        // so none is behind a scroll nobody sees.
        listClassName="flex-wrap"
      />
    </SettingsSection>
  );
}
