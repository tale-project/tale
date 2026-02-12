'use client';

import { Code, Database, Key, Globe, Pencil, Puzzle, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { Image } from '@/app/components/ui/data-display/image';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Center } from '@/app/components/ui/layout/layout';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import type { ParsedPackage } from '../utils/parse-integration-package';

const MAX_ICON_SIZE = 256 * 1024; // 256KB
const ACCEPTED_ICON_TYPES = new Set([
  'image/png',
  'image/svg+xml',
  'image/jpeg',
  'image/webp',
]);

interface PreviewStepProps {
  parsedPackage: ParsedPackage;
  onIconChange?: (iconFile: File | undefined) => void;
}

export function PreviewStep({ parsedPackage, onIconChange }: PreviewStepProps) {
  const { t } = useT('settings');
  const { config, connectorCode, iconFile } = parsedPackage;
  const iconInputRef = useRef<HTMLInputElement>(null);

  const lineCount = connectorCode.trim().split('\n').length;

  const iconPreviewUrl = useMemo(
    () => (iconFile ? URL.createObjectURL(iconFile) : null),
    [iconFile],
  );

  useEffect(() => {
    return () => {
      if (iconPreviewUrl) {
        URL.revokeObjectURL(iconPreviewUrl);
      }
    };
  }, [iconPreviewUrl]);

  const handleIconUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (e.target) e.target.value = '';
      if (!file || !onIconChange) return;

      if (file.size > MAX_ICON_SIZE) {
        toast({
          title: t('integrations.upload.iconTooLarge'),
          variant: 'destructive',
        });
        return;
      }
      if (!ACCEPTED_ICON_TYPES.has(file.type)) {
        toast({
          title: t('integrations.upload.invalidIconFormat'),
          variant: 'destructive',
        });
        return;
      }

      onIconChange(file);
    },
    [onIconChange, t],
  );

  return (
    <Stack gap={4} className="min-w-0 overflow-hidden">
      <input
        ref={iconInputRef}
        type="file"
        accept="image/png,image/svg+xml,image/jpeg,image/webp"
        className="hidden"
        onChange={handleIconUpload}
        aria-label={t('integrations.upload.changeIcon')}
      />
      <HStack gap={3}>
        <button
          type="button"
          className="group relative shrink-0"
          onClick={() => iconInputRef.current?.click()}
          aria-label={t('integrations.upload.changeIcon')}
        >
          <Center className="border-border group-hover:border-primary/50 h-11 w-11 rounded-md border transition-colors">
            {iconPreviewUrl ? (
              <Image
                src={iconPreviewUrl}
                alt={config.title}
                className="size-6 rounded object-contain"
              />
            ) : (
              <Puzzle className="size-6" />
            )}
          </Center>
          <span className="bg-background border-border absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full border shadow-sm">
            <Pencil className="size-2.5" />
          </span>
        </button>
        <Stack gap={1}>
          <h3 className="text-sm font-medium">{config.title}</h3>
          {config.description && (
            <p className="text-muted-foreground text-sm">
              {config.description}
            </p>
          )}
          <HStack gap={2} className="mt-1 flex-wrap">
            <Badge variant="outline">{config.authMethod}</Badge>
            {config.type === 'sql' && <Badge variant="outline">SQL</Badge>}
            {config.version && (
              <Badge variant="outline">v{config.version}</Badge>
            )}
          </HStack>
        </Stack>
      </HStack>

      <Stack gap={2}>
        <HStack gap={2} className="text-sm font-medium">
          <Zap className="size-4 shrink-0" />
          {t('integrations.upload.operations')} ({config.operations.length})
        </HStack>
        <ul
          className="bg-muted max-h-48 space-y-1 overflow-y-auto rounded-md p-3 text-sm"
          role="list"
        >
          {config.operations.map((op) => (
            <li key={op.name} className="flex min-w-0 items-center gap-2">
              <span className="truncate font-mono text-xs">{op.name}</span>
              {op.title && (
                <span className="text-muted-foreground shrink-0 text-xs">
                  — {op.title}
                </span>
              )}
              {op.operationType === 'write' && (
                <Badge variant="outline" className="shrink-0 text-xs">
                  {t('integrations.upload.write')}
                </Badge>
              )}
            </li>
          ))}
        </ul>
      </Stack>

      <Stack gap={2}>
        <HStack gap={2} className="text-sm font-medium">
          <Key className="size-4 shrink-0" />
          {t('integrations.upload.secretBindings')}
        </HStack>
        <HStack gap={1} className="flex-wrap">
          {config.secretBindings.map((binding) => (
            <Badge key={binding} variant="blue">
              {binding}
            </Badge>
          ))}
        </HStack>
      </Stack>

      {config.type === 'sql' && config.sqlConnectionConfig && (
        <Stack gap={2}>
          <HStack gap={2} className="text-sm font-medium">
            <Database className="size-4 shrink-0" />
            {t('integrations.upload.sqlConfig')}
          </HStack>
          <dl className="bg-muted grid grid-cols-2 gap-x-4 gap-y-1 rounded-md p-3 text-xs">
            <dt className="text-muted-foreground">
              {t('integrations.upload.engine')}
            </dt>
            <dd className="font-mono">{config.sqlConnectionConfig.engine}</dd>
            {config.sqlConnectionConfig.port && (
              <>
                <dt className="text-muted-foreground">
                  {t('integrations.upload.port')}
                </dt>
                <dd className="font-mono">{config.sqlConnectionConfig.port}</dd>
              </>
            )}
            {config.sqlConnectionConfig.readOnly !== undefined && (
              <>
                <dt className="text-muted-foreground">
                  {t('integrations.upload.readOnly')}
                </dt>
                <dd>{config.sqlConnectionConfig.readOnly ? 'Yes' : 'No'}</dd>
              </>
            )}
            {config.sqlConnectionConfig.security?.maxResultRows && (
              <>
                <dt className="text-muted-foreground">
                  {t('integrations.upload.maxResultRows')}
                </dt>
                <dd className="font-mono">
                  {config.sqlConnectionConfig.security.maxResultRows}
                </dd>
              </>
            )}
            {config.sqlConnectionConfig.security?.queryTimeoutMs && (
              <>
                <dt className="text-muted-foreground">
                  {t('integrations.upload.queryTimeout')}
                </dt>
                <dd className="font-mono">
                  {config.sqlConnectionConfig.security.queryTimeoutMs}
                </dd>
              </>
            )}
          </dl>
        </Stack>
      )}

      {config.allowedHosts && config.allowedHosts.length > 0 && (
        <Stack gap={2}>
          <HStack gap={2} className="text-sm font-medium">
            <Globe className="size-4 shrink-0" />
            {t('integrations.upload.allowedHosts')}
          </HStack>
          <HStack gap={1} className="flex-wrap">
            {config.allowedHosts.map((host) => (
              <Badge key={host} variant="outline">
                {host}
              </Badge>
            ))}
          </HStack>
        </Stack>
      )}

      {connectorCode.trim().length > 0 && config.type !== 'sql' && (
        <details className="group min-w-0">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <Code className="size-4 shrink-0" />
            {t('integrations.upload.connectorCode')}
            <Badge variant="outline" className="text-xs">
              {lineCount} {t('integrations.upload.lines')}
            </Badge>
          </summary>
          <pre className="bg-muted mt-2 max-h-48 overflow-auto rounded-md p-3 text-xs">
            {connectorCode}
          </pre>
        </details>
      )}
    </Stack>
  );
}
