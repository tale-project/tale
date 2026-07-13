'use client';

import { Badge } from '@tale/ui/badge';
import { Button, LinkButton } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { CodeBlock } from '@tale/ui/code-block';
import { EmptyState } from '@tale/ui/empty-state';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Cpu, KeyRound } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useCreateApiKey } from '@/app/features/settings/api-keys/hooks/use-api-keys';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { useSiteUrl } from '@/lib/site-url-context';
import { cn } from '@/lib/utils/cn';

interface RuntimeRow {
  daemonId: string;
  adapterType: string;
  name?: string;
  version?: string;
  workspaceKeys?: string[];
  status: 'active' | 'degraded' | 'offline';
  lastHeartbeatAt: number;
}

const STATUS_BADGE: Record<RuntimeRow['status'], string> = {
  active: 'text-success border-success/40',
  degraded: 'text-warning border-warning/40',
  offline: 'text-destructive border-destructive/40',
};

const CLI_INSTALL_COMMAND =
  'curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash';
const SETUP_COMMANDS = 'tale daemon setup\ntale daemon start';

/**
 * The one-liner the "generate & copy" button produces: a fresh key plus this
 * workspace's canonical URL are baked into `tale daemon setup --yes`, so
 * pasting it on the target machine registers a daemon without any further
 * URL/key prompts. `start` follows to open the claim loop.
 */
function buildSetupCommand(siteUrl: string, apiKey: string): string {
  const url = siteUrl.replace(/\/$/, '');
  return `tale daemon setup --yes --url ${url} --key ${apiKey}\ntale daemon start`;
}

/**
 * Settings → API → Runtimes — built on the shared settings UI
 * (SettingsSection, CodeBlock, EmptyState) so it matches every other settings
 * page: a connect-a-daemon section plus the live fleet list (one row per
 * daemon, its detected adapters with versions, advertised workspace keys, and
 * heartbeat-derived status).
 */
export function RuntimesSettings({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('runtimes');
  const { formatRelative } = useFormatDate();
  const { toast } = useToast();
  const siteUrl = useSiteUrl();
  const { mutateAsync: createKey, isPending: isGenerating } =
    useCreateApiKey(organizationId);
  // The minted key is shown exactly once, embedded in the setup command; it is
  // never logged and clears when the user leaves or regenerates.
  const [setupCommand, setSetupCommand] = useState<string | null>(null);
  const { data } = useConvexQuery(api.agent_runtimes.queries.listRuntimes, {
    organizationId,
  });

  const handleGenerate = async () => {
    try {
      const { key } = await createKey({ name: t('install.keyName') });
      const command = buildSetupCommand(siteUrl, key);
      setSetupCommand(command);
      try {
        await navigator.clipboard.writeText(command);
        toast({ title: t('install.copied'), variant: 'success' });
      } catch {
        // Clipboard can be blocked (permissions/insecure context) — the
        // command is still shown below with its own copy button.
        toast({ title: t('install.generated'), variant: 'success' });
      }
    } catch (error) {
      console.error('runtimes: generate daemon key failed', error);
      toast({ title: t('install.generateError'), variant: 'destructive' });
    }
  };
  const daemons = useMemo(() => {
    const rows: RuntimeRow[] = data ?? [];
    const byDaemon = new Map<string, RuntimeRow[]>();
    for (const row of rows) {
      const list = byDaemon.get(row.daemonId) ?? [];
      list.push(row);
      byDaemon.set(row.daemonId, list);
    }
    return [...byDaemon.entries()];
  }, [data]);

  return (
    <>
      <SettingsSection
        title={t('install.title')}
        description={t('description')}
        action={
          <LinkButton
            variant="primary"
            icon={KeyRound}
            href="/dashboard/$id/settings/api/rest"
            params={{ id: organizationId }}
          >
            {t('install.createKey')}
          </LinkButton>
        }
      >
        <Text as="p" variant="muted" className="text-sm">
          {t('install.cliHint')}
        </Text>
        <CodeBlock copyValue={CLI_INSTALL_COMMAND}>
          {CLI_INSTALL_COMMAND}
        </CodeBlock>
        <Text as="p" variant="muted" className="text-sm">
          {t('install.description')}
        </Text>
        {setupCommand ? (
          <>
            <CodeBlock
              label={t('install.commandLabel')}
              copyValue={setupCommand}
              copyLabel={t('install.copyCommand')}
            >
              {setupCommand}
            </CodeBlock>
            <Text as="p" variant="muted" className="text-xs">
              {t('install.keyCaveat')}
            </Text>
          </>
        ) : (
          <>
            <Button
              icon={KeyRound}
              onClick={handleGenerate}
              isLoading={isGenerating}
            >
              {t('install.generate')}
            </Button>
            <Text as="p" variant="muted" className="text-xs">
              {t('install.generateHint')}
            </Text>
            <CodeBlock copyValue={SETUP_COMMANDS}>{SETUP_COMMANDS}</CodeBlock>
          </>
        )}
        <Text as="p" variant="muted" className="text-xs">
          {t('install.privacy')}
        </Text>
      </SettingsSection>

      <SettingsSection title={t('list.title')}>
        {daemons.length === 0 ? (
          <EmptyState
            icon={Cpu}
            title={t('list.empty')}
            description={t('list.emptyHint')}
          />
        ) : (
          <Stack as="ul" gap={2}>
            {daemons.map(([daemonId, adapters]) => {
              const first = adapters[0];
              const worst: RuntimeRow['status'] = adapters.some(
                (a) => a.status === 'offline',
              )
                ? 'offline'
                : adapters.some((a) => a.status === 'degraded')
                  ? 'degraded'
                  : 'active';
              return (
                <Card asChild padding="sm" key={daemonId}>
                  <li className="flex flex-col gap-2">
                    <Row gap={2} wrap>
                      <Text
                        as="h3"
                        variant="label"
                        className="min-w-0 truncate"
                      >
                        {first?.name || daemonId}
                      </Text>
                      <Badge
                        variant="outline"
                        className={cn('text-[10px]', STATUS_BADGE[worst])}
                      >
                        {t(`status.${worst}`)}
                      </Badge>
                      <Text
                        as="span"
                        variant="muted"
                        className="ml-auto shrink-0 text-xs"
                      >
                        {t('list.lastSeen', {
                          age: formatRelative(
                            new Date(
                              Math.max(
                                ...adapters.map((a) => a.lastHeartbeatAt),
                              ),
                            ),
                          ),
                        })}
                      </Text>
                    </Row>
                    <Text as="p" variant="muted" className="font-mono text-xs">
                      {daemonId}
                    </Text>
                    <ul className="flex flex-wrap gap-1.5">
                      {adapters.map((adapter) => (
                        <li key={adapter.adapterType}>
                          <Badge variant="outline" className="text-[10px]">
                            {adapter.adapterType}
                            {adapter.version ? ` · ${adapter.version}` : ''}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                    {first?.workspaceKeys && first.workspaceKeys.length > 0 && (
                      <Text as="p" variant="muted" className="text-xs">
                        {t('list.workspaces', {
                          keys: first.workspaceKeys.join(', '),
                        })}
                      </Text>
                    )}
                  </li>
                </Card>
              );
            })}
          </Stack>
        )}
      </SettingsSection>
    </>
  );
}
