'use client';

import {
  EMBEDDING_FRAME_ANCESTORS_MAX,
  embeddingConfigSchema,
  isFrameAncestorOrigin,
  type EmbeddingConfig,
} from '@tale/shared/schemas/governance';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { HStack, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Textarea } from '@tale/ui/textarea';
import { useToast } from '@tale/ui/use-toast';
import { useEffect, useMemo, useState } from 'react';

import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { SettingsToggleRow } from '@/app/features/settings/components/settings-toggle-row';
import { useUpsertGovernancePolicy } from '@/app/features/settings/governance/hooks/mutations';
import { useGovernancePolicy } from '@/app/features/settings/governance/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { backendErrorMessage } from '@/lib/utils/backend-error';
import { isRecord } from '@/lib/utils/type-utils';

const NO_EMBEDDING: EmbeddingConfig = { enabled: false, frameAncestors: [] };

/** The stored `embedding` policy, or the closed default when absent or unreadable. */
export function embeddingConfigFrom(config: unknown): EmbeddingConfig {
  const parsed = embeddingConfigSchema.safeParse(
    isRecord(config) ? config : null,
  );
  return parsed.success ? parsed.data : NO_EMBEDDING;
}

/** The origins typed into the textarea: trimmed, blank lines dropped, deduplicated. */
export function parseOriginLines(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    ),
  ];
}

/**
 * The embedding card on Settings > Enterprise SSO: which web origins may
 * show this organization's pages inside a frame. It edits the `embedding`
 * governance policy — a file under the organization's config tree, so the
 * web tier's security headers and the trusted-headers door read the same
 * rule `tale config apply` can write. The switch saves at once (like the
 * trusted-headers switch); the origin list saves from its own button once it
 * is valid, so a half-typed origin never reaches a response header.
 */
export function EmbeddingSection({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('settings');
  const { toast } = useToast();
  const ability = useAbility();
  const canEdit = ability.can('write', 'orgSettings');

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'embedding',
  );
  const save = useUpsertGovernancePolicy({ errorToast: false });
  const stored = useMemo(
    () => embeddingConfigFrom(policy?.config),
    [policy?.config],
  );

  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  // Follow the stored list until the admin starts typing; a save resets
  // `touched` so the next server value lands in the field again.
  useEffect(() => {
    if (!touched) setText(stored.frameAncestors.join('\n'));
  }, [stored, touched]);

  const lines = useMemo(() => parseOriginLines(text), [text]);
  const invalid = lines.filter((line) => !isFrameAncestorOrigin(line));
  const tooMany = lines.length > EMBEDDING_FRAME_ANCESTORS_MAX;
  const dirty = lines.join('\n') !== stored.frameAncestors.join('\n');
  const errorMessage =
    invalid.length > 0
      ? t('enterpriseSso.embedding.invalidOrigin')
      : tooMany
        ? t('enterpriseSso.embedding.tooMany', {
            max: EMBEDDING_FRAME_ANCESTORS_MAX,
          })
        : undefined;

  const persist = async (config: EmbeddingConfig) => {
    try {
      await save.mutateAsync({
        organizationId,
        policyType: 'embedding',
        config,
      });
      setTouched(false);
      toast({ title: t('enterpriseSso.embedding.saved'), variant: 'success' });
    } catch (error) {
      toast({
        title: t('enterpriseSso.embedding.saveFailed'),
        description: backendErrorMessage(error, ''),
        variant: 'destructive',
      });
    }
  };

  return (
    <SettingsSection
      title={
        <HStack gap={2} align="center" wrap>
          {t('enterpriseSso.embedding.section')}
          {stored.enabled ? (
            <Badge variant="green" dot>
              {t('enterpriseSso.embedding.enabled')}
            </Badge>
          ) : (
            <Badge variant="slate" dot>
              {t('enterpriseSso.embedding.disabled')}
            </Badge>
          )}
        </HStack>
      }
      description={t('enterpriseSso.embedding.help')}
    >
      <Stack gap={4}>
        <SettingsToggleRow
          label={t('enterpriseSso.embedding.toggleLabel')}
          description={t('enterpriseSso.embedding.toggleHelp')}
          checked={stored.enabled}
          onCheckedChange={(checked) =>
            void persist({ ...stored, enabled: checked })
          }
          disabled={!canEdit || isLoading || save.isPending}
          ariaBusy={save.isPending}
        />
        <SettingsFieldList>
          <SettingsFieldRow
            label={t('enterpriseSso.embedding.originsLabel')}
            description={t('enterpriseSso.embedding.originsHelp', {
              max: EMBEDDING_FRAME_ANCESTORS_MAX,
            })}
            layout="stack"
          >
            <Stack gap={2}>
              <Textarea
                id="embedding-frame-ancestors"
                aria-label={t('enterpriseSso.embedding.originsLabel')}
                placeholder={t('enterpriseSso.embedding.originsPlaceholder')}
                value={text}
                onChange={(event) => {
                  setTouched(true);
                  setText(event.target.value);
                }}
                rows={4}
                disabled={!canEdit || isLoading}
                {...(errorMessage !== undefined ? { errorMessage } : {})}
              />
              <HStack gap={2} justify="end">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={
                    !canEdit ||
                    isLoading ||
                    !dirty ||
                    errorMessage !== undefined ||
                    save.isPending
                  }
                  isLoading={save.isPending}
                  onClick={() =>
                    void persist({ ...stored, frameAncestors: lines })
                  }
                >
                  {t('enterpriseSso.embedding.save')}
                </Button>
              </HStack>
            </Stack>
          </SettingsFieldRow>
        </SettingsFieldList>
        <Text variant="muted">{t('enterpriseSso.embedding.sameSiteNote')}</Text>
      </Stack>
    </SettingsSection>
  );
}
