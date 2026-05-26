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
  const fileCount = assets.length + 1;
  const unknownKeyCount = Object.keys(meta.unknown).length;
  const recommendedPython = meta.recommendedPackages?.python ?? [];
  const recommendedNode = meta.recommendedPackages?.node ?? [];

  return (
    <Stack gap={4} className="min-w-0 overflow-hidden">
      <Stack gap={1}>
        <Heading level={3} size="sm" weight="medium" className="font-mono">
          {slug}
        </Heading>
        <Text variant="muted">{meta.description}</Text>
      </Stack>

      {(meta.license !== undefined ||
        recommendedPython.length > 0 ||
        recommendedNode.length > 0 ||
        meta.disableModelInvocation ||
        unknownKeyCount > 0) && (
        <Stack gap={2}>
          <Text variant="label">
            {t('skills.upload.frontmatter', {
              defaultValue: 'Frontmatter',
            })}
          </Text>
          <Stack gap={1} className="text-sm">
            {meta.license !== undefined && (
              <HStack gap={2} align="center">
                <Text as="span" variant="caption" className="shrink-0">
                  {t('skills.upload.license', { defaultValue: 'License' })}
                </Text>
                <Text as="span" variant="code">
                  {meta.license}
                </Text>
              </HStack>
            )}
            {recommendedPython.length > 0 && (
              <HStack gap={2} align="center" className="flex-wrap">
                <Text as="span" variant="caption" className="shrink-0">
                  {t('skills.upload.recommendedPython', {
                    defaultValue: 'Recommended Python',
                  })}
                </Text>
                {recommendedPython.map((spec) => (
                  <Text as="span" key={`py:${spec}`} variant="code">
                    {spec}
                  </Text>
                ))}
              </HStack>
            )}
            {recommendedNode.length > 0 && (
              <HStack gap={2} align="center" className="flex-wrap">
                <Text as="span" variant="caption" className="shrink-0">
                  {t('skills.upload.recommendedNode', {
                    defaultValue: 'Recommended Node',
                  })}
                </Text>
                {recommendedNode.map((spec) => (
                  <Text as="span" key={`node:${spec}`} variant="code">
                    {spec}
                  </Text>
                ))}
              </HStack>
            )}
            {meta.disableModelInvocation && (
              <Text as="span" variant="caption">
                {t('skills.upload.disableModelInvocation', {
                  defaultValue:
                    'Skill is hidden from the model — explicit invocation only.',
                })}
              </Text>
            )}
            {unknownKeyCount > 0 && (
              <Text as="span" variant="caption">
                {t('skills.upload.unknownKeys', {
                  defaultValue:
                    '{count} additional frontmatter key(s) preserved',
                  count: unknownKeyCount,
                })}
              </Text>
            )}
          </Stack>
        </Stack>
      )}

      <Stack gap={2}>
        <HStack gap={2} align="center" justify="between">
          <Text variant="label">
            {t('skills.upload.bundleFiles', {
              defaultValue: 'Bundle files',
            })}
          </Text>
          <Text variant="caption">
            {t('skills.upload.fileCount', {
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
              SKILL.md
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
