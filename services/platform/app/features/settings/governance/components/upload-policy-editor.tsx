'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Input } from '@/app/components/ui/forms/input';
import { Switch } from '@/app/components/ui/forms/switch';
import { Stack } from '@/app/components/ui/layout/layout';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useAbility } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  uploadPolicyConfigSchema,
  type UploadPolicyConfig,
} from '@/lib/shared/schemas/governance';
import { isRecord } from '@/lib/utils/type-guards';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';

interface UploadPolicyEditorProps {
  organizationId: string;
}

function parseConfig(raw: unknown): UploadPolicyConfig {
  const obj = isRecord(raw) ? raw : {};
  const result = uploadPolicyConfigSchema.safeParse(obj);
  if (result.success) return result.data;
  return { enabled: false };
}

function extensionsToString(exts?: string[]): string {
  return exts?.join(', ') ?? '';
}

function stringToExtensions(value: string): string[] | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed
    .split(/[,\s]+/)
    .map((s) => s.trim().replace(/^\./, ''))
    .filter(Boolean);
}

export function UploadPolicyEditor({
  organizationId,
}: UploadPolicyEditorProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'upload_policy',
  );
  const upsertMutation = useUpsertGovernancePolicy();

  const savedConfig = useMemo(() => parseConfig(policy?.config), [policy]);

  const [enabled, setEnabled] = useState(false);
  const [allowedExtensions, setAllowedExtensions] = useState('');
  const [blockedExtensions, setBlockedExtensions] = useState('');
  const [allowedMimeTypes, setAllowedMimeTypes] = useState('');
  const [maxFileSizeMB, setMaxFileSizeMB] = useState('');
  const [maxVolumeGB, setMaxVolumeGB] = useState('');

  useEffect(() => {
    setEnabled(savedConfig.enabled);
    setAllowedExtensions(extensionsToString(savedConfig.allowedExtensions));
    setBlockedExtensions(extensionsToString(savedConfig.blockedExtensions));
    setAllowedMimeTypes(savedConfig.allowedMimeTypes?.join(', ') ?? '');
    setMaxFileSizeMB(
      savedConfig.maxFileSizeBytes != null
        ? String(savedConfig.maxFileSizeBytes / (1024 * 1024))
        : '',
    );
    setMaxVolumeGB(
      savedConfig.maxTotalVolumeBytesPerUser != null
        ? String(savedConfig.maxTotalVolumeBytesPerUser / (1024 * 1024 * 1024))
        : '',
    );
  }, [savedConfig]);

  const cannotManage = ability.cannot('write', 'orgSettings');

  const buildConfig = useCallback((): UploadPolicyConfig => {
    const config: UploadPolicyConfig = { enabled };

    const allowed = stringToExtensions(allowedExtensions);
    if (allowed) config.allowedExtensions = allowed;

    const blocked = stringToExtensions(blockedExtensions);
    if (blocked) config.blockedExtensions = blocked;

    const mimes = allowedMimeTypes
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (mimes.length > 0) config.allowedMimeTypes = mimes;

    const sizeMB = Number(maxFileSizeMB);
    if (maxFileSizeMB && !Number.isNaN(sizeMB) && sizeMB > 0) {
      config.maxFileSizeBytes = sizeMB * 1024 * 1024;
    }

    const volGB = Number(maxVolumeGB);
    if (maxVolumeGB && !Number.isNaN(volGB) && volGB > 0) {
      config.maxTotalVolumeBytesPerUser = volGB * 1024 * 1024 * 1024;
    }

    return config;
  }, [
    enabled,
    allowedExtensions,
    blockedExtensions,
    allowedMimeTypes,
    maxFileSizeMB,
    maxVolumeGB,
  ]);

  const handleSave = useCallback(async () => {
    try {
      await upsertMutation.mutateAsync({
        organizationId,
        policyType: 'upload_policy',
        config: buildConfig(),
      });
      toast({ title: t('uploadPolicy.saved'), variant: 'success' });
    } catch {
      toast({
        title: t('uploadPolicy.saveFailed'),
        variant: 'destructive',
      });
    }
  }, [organizationId, buildConfig, upsertMutation, toast, t]);

  const handleToggleEnabled = useCallback((checked: boolean) => {
    setEnabled(checked);
  }, []);

  if (isLoading) {
    return null;
  }

  return (
    <PageSection
      title={t('uploadPolicy.title')}
      description={t('uploadPolicy.description')}
      action={
        <Switch
          label={t('uploadPolicy.enabled')}
          checked={enabled}
          onCheckedChange={handleToggleEnabled}
          disabled={cannotManage || upsertMutation.isPending}
        />
      }
    >
      <Stack gap={6} className="max-w-2xl">
        {!enabled && (
          <Text variant="muted" className="text-sm">
            {t('uploadPolicy.policyDisabledHint')}
          </Text>
        )}

        <Stack gap={4}>
          <div>
            <Input
              label={t('uploadPolicy.allowedExtensions')}
              value={allowedExtensions}
              onChange={(e) => setAllowedExtensions(e.target.value)}
              placeholder={t('uploadPolicy.extensionPlaceholder')}
              disabled={cannotManage || !enabled}
              size="sm"
            />
          </div>

          <div>
            <Input
              label={t('uploadPolicy.blockedExtensions')}
              value={blockedExtensions}
              onChange={(e) => setBlockedExtensions(e.target.value)}
              placeholder={t('uploadPolicy.extensionPlaceholder')}
              disabled={cannotManage || !enabled}
              size="sm"
            />
          </div>

          <div>
            <Input
              label={t('uploadPolicy.allowedMimeTypes')}
              value={allowedMimeTypes}
              onChange={(e) => setAllowedMimeTypes(e.target.value)}
              placeholder={t('uploadPolicy.mimeTypePlaceholder')}
              disabled={cannotManage || !enabled}
              size="sm"
            />
          </div>

          <div>
            <Input
              label={`${t('uploadPolicy.maxFileSize')} (${t('uploadPolicy.mbUnit')})`}
              type="number"
              value={maxFileSizeMB}
              onChange={(e) => setMaxFileSizeMB(e.target.value)}
              disabled={cannotManage || !enabled}
              size="sm"
              min={0}
              step={1}
            />
          </div>

          <div>
            <Input
              label={`${t('uploadPolicy.maxVolumePerUser')} (${t('uploadPolicy.gbUnit')})`}
              type="number"
              value={maxVolumeGB}
              onChange={(e) => setMaxVolumeGB(e.target.value)}
              disabled={cannotManage || !enabled}
              size="sm"
              min={0}
              step={0.1}
            />
          </div>
        </Stack>

        <Button
          onClick={handleSave}
          disabled={cannotManage || upsertMutation.isPending}
          size="sm"
          className="self-start"
        >
          {upsertMutation.isPending
            ? t('systemPrompt.saving')
            : t('systemPrompt.save')}
        </Button>
      </Stack>
    </PageSection>
  );
}
