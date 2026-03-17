'use client';

import { AlertCircle } from 'lucide-react';
import { useState, useCallback } from 'react';

import { Image } from '@/app/components/ui/data-display/image';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Spinner } from '@/app/components/ui/feedback/spinner';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { IntegrationTemplate } from '../constants/integration-templates';
import type { ParsedPackage } from '../utils/parse-integration-package';

import {
  INTEGRATION_TEMPLATES,
  getTemplateIconUrl,
} from '../constants/integration-templates';
import { fetchTemplateFiles } from '../utils/fetch-template-files';

interface TemplateStepProps {
  onPackageParsed: (pkg: ParsedPackage) => void;
}

export function TemplateStep({ onPackageParsed }: TemplateStepProps) {
  const { t } = useT('settings');
  const [fetchingTemplate, setFetchingTemplate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSelectTemplate = useCallback(
    async (template: IntegrationTemplate) => {
      setError(null);
      setFetchingTemplate(template.name);

      try {
        const result = await fetchTemplateFiles(template);
        if (result.success && result.data) {
          onPackageParsed(result.data);
        } else {
          setError(result.error ?? t('integrations.upload.templateFetchError'));
        }
      } catch {
        setError(t('integrations.upload.templateFetchError'));
      } finally {
        setFetchingTemplate(null);
      }
    },
    [onPackageParsed, t],
  );

  return (
    <Stack gap={4}>
      <Text variant="muted">
        {t('integrations.upload.templateDescription')}
      </Text>

      {error && (
        <div
          className="bg-destructive/10 text-destructive flex items-start gap-2 rounded-md p-3 text-sm"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div
        className="grid max-h-100 grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2"
        aria-busy={!!fetchingTemplate}
      >
        {INTEGRATION_TEMPLATES.map((template) => (
          <button
            key={template.name}
            type="button"
            onClick={() => handleSelectTemplate(template)}
            disabled={!!fetchingTemplate}
            className={cn(
              'border-border hover:border-primary/50 flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
              fetchingTemplate === template.name && 'border-primary/50',
              fetchingTemplate &&
                fetchingTemplate !== template.name &&
                'opacity-50',
            )}
            aria-label={`${template.title} — ${t(`integrations.authMethods.${template.authMethod}`)}`}
          >
            <div className="border-border flex size-9 shrink-0 items-center justify-center rounded-md border">
              <Image
                src={getTemplateIconUrl(template.name)}
                alt={template.title}
                className="size-5 object-contain"
              />
            </div>
            <Stack gap={1} className="min-w-0 flex-1">
              <HStack gap={2} className="items-center">
                <Text variant="label" className="truncate">
                  {template.title}
                </Text>
                <Badge
                  variant="outline"
                  className="px-1.5 py-0.5 text-[10px] leading-tight"
                >
                  {t(`integrations.authMethods.${template.authMethod}`)}
                </Badge>
                {template.type === 'sql' && (
                  <Badge
                    variant="outline"
                    className="px-1.5 py-0.5 text-[10px] leading-tight"
                  >
                    SQL
                  </Badge>
                )}
              </HStack>
              <Text variant="caption" className="line-clamp-2">
                {template.description}
              </Text>
            </Stack>
            {fetchingTemplate === template.name && (
              <Spinner
                size="sm"
                label={t('integrations.upload.templateFetching')}
                className="mt-0.5 shrink-0"
              />
            )}
          </button>
        ))}
      </div>
    </Stack>
  );
}
