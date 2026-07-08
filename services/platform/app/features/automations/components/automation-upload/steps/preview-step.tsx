'use client';

import { Badge } from '@tale/ui/badge';
import { Heading } from '@tale/ui/heading';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { HStack, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import { useT } from '@/lib/i18n/client';
import {
  AUTOMATION_MANIFEST_FILENAME,
  automationScope,
} from '@/lib/shared/schemas/automations';
import { formatBytes } from '@/lib/utils/format-bytes';

import type { ParsedAutomationBundle } from '../utils/parse-automation-bundle';

interface PreviewStepProps {
  parsedBundle: ParsedAutomationBundle;
}

export function PreviewStep({ parsedBundle }: PreviewStepProps) {
  const { t } = useT('automations');
  const { locale } = useLocale();
  const { slug, manifest, assets, totalBytes } = parsedBundle;
  const fileCount = assets.length + 1;
  const scope = automationScope(manifest);
  const workflows = manifest.workflow ? [manifest.workflow.name] : [];
  const agents = manifest.agents ?? [];
  const requiredIntegrations = manifest.requires?.integrations ?? [];

  return (
    <Stack gap={4} className="min-w-0 overflow-hidden">
      <Stack gap={1}>
        <HStack gap={2} align="center" className="flex-wrap">
          <Heading level={3} size="sm" weight="medium">
            {manifest.name}
          </Heading>
          <Text as="span" variant="code">
            {slug}
          </Text>
          <Badge variant={scope === 'project' ? 'blue' : 'slate'}>
            {scope === 'project'
              ? t('upload.scopeProject', { defaultValue: 'Project automation' })
              : t('upload.scopeOrg', { defaultValue: 'Org automation' })}
          </Badge>
        </HStack>
        {manifest.description ? (
          <Text variant="muted">{manifest.description}</Text>
        ) : null}
      </Stack>

      <Stack gap={1} className="text-sm">
        {workflows.length > 0 && (
          <HStack gap={2} align="center" className="flex-wrap">
            <Text as="span" variant="caption" className="shrink-0">
              {t('upload.workflows', { defaultValue: 'Workflows' })}
            </Text>
            {workflows.map((w) => (
              <Text as="span" key={`wf:${w}`} variant="code">
                {w}
              </Text>
            ))}
          </HStack>
        )}
        {agents.length > 0 && (
          <HStack gap={2} align="center" className="flex-wrap">
            <Text as="span" variant="caption" className="shrink-0">
              {t('upload.agents', { defaultValue: 'Agents' })}
            </Text>
            {agents.map((a) => (
              <Text as="span" key={`agent:${a}`} variant="code">
                {a}
              </Text>
            ))}
          </HStack>
        )}
        {requiredIntegrations.length > 0 && (
          <HStack gap={2} align="center" className="flex-wrap">
            <Text as="span" variant="caption" className="shrink-0">
              {t('upload.requiresIntegrations', {
                defaultValue: 'Requires integrations',
              })}
            </Text>
            {requiredIntegrations.map((i) => (
              <Text as="span" key={`int:${i}`} variant="code">
                {i}
              </Text>
            ))}
          </HStack>
        )}
      </Stack>

      <Stack gap={2}>
        <HStack gap={2} align="center" justify="between">
          <Text variant="label">
            {t('upload.bundleFiles', { defaultValue: 'Package files' })}
          </Text>
          <Text variant="caption">
            {t('upload.fileCount', {
              defaultValue: '{count, plural, one {# file} other {# files}}',
              count: fileCount,
            })}
            {' · '}
            {formatBytes(totalBytes, locale)}
          </Text>
        </HStack>
        <ul
          className="bg-muted max-h-64 space-y-1 overflow-y-auto rounded-md p-3 text-sm"
          role="list"
        >
          <li className="flex items-center justify-between gap-2">
            <Text as="span" variant="code" truncate>
              {AUTOMATION_MANIFEST_FILENAME}
            </Text>
          </li>
          {assets.map((a) => (
            <li
              key={a.relPath}
              className="flex items-center justify-between gap-2"
            >
              <Text as="span" variant="code" truncate title={a.relPath}>
                {a.relPath}
              </Text>
              <Text as="span" variant="caption" className="shrink-0">
                {formatBytes(a.size, locale)}
              </Text>
            </li>
          ))}
        </ul>
      </Stack>
    </Stack>
  );
}
