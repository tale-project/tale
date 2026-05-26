'use client';

import { Heading } from '@tale/ui/heading';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { HStack, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import { useT } from '@/lib/i18n/client';
import { formatBytes } from '@/lib/utils/format-bytes';

import type { ParsedSkillBundle } from '../utils/parse-skill-bundle';

interface PreviewStepProps {
  parsedBundle: ParsedSkillBundle;
}

export function PreviewStep({ parsedBundle }: PreviewStepProps) {
  const { t } = useT('settings');
  const { locale } = useLocale();
  const { slug, meta, assets, totalBytes } = parsedBundle;

  return (
    <Stack gap={4} className="min-w-0 overflow-hidden">
      <Stack gap={1}>
        <Heading level={3} size="sm" weight="medium" className="font-mono">
          {slug}
        </Heading>
        <Text variant="muted">{meta.description}</Text>
      </Stack>

      <Stack gap={2}>
        <HStack gap={2} align="center" justify="between">
          <Text variant="label">
            {t('skills.upload.bundleFiles', {
              defaultValue: 'Bundle files',
            })}
          </Text>
          <Text variant="caption">
            {assets.length + 1}{' '}
            {t('skills.upload.fileCount', {
              defaultValue: 'files',
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
              SKILL.md
            </Text>
          </li>
          {assets.map((a) => (
            <li
              key={a.relPath}
              className="flex items-center justify-between gap-2"
            >
              <Text as="span" variant="code" truncate>
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
