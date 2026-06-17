'use client';

import { Button } from '@tale/ui/button';
import { Description } from '@tale/ui/description';
import { EmptyPlaceholder } from '@tale/ui/empty-placeholder';
import { Stack, HStack } from '@tale/ui/layout';
import { SectionHeader } from '@tale/ui/section-header';
import { SelectableRow } from '@tale/ui/selectable-row';
import { Separator } from '@tale/ui/separator';
import { Spinner } from '@tale/ui/spinner';
import { Database, Loader2, Users } from 'lucide-react';

import { FormSection } from '@/app/components/ui/forms/form-section';
import {
  RadioGroup,
  RadioGroupItem,
} from '@/app/components/ui/forms/radio-group';
import { Select } from '@/app/components/ui/forms/select';
import { useT } from '@/lib/i18n/client';
import { narrowStringUnion } from '@/lib/utils/type-utils';

import type { ImportType } from './types';

// Radix <Select.Item> rejects an empty-string value, so the "org-wide" choice
// uses a sentinel that maps back to `undefined` (no team) on selection.
const ORG_WIDE_TEAM = '__org_wide__';

interface OneDriveSettingsStageProps {
  selectedItemCount: number;
  importType: ImportType;
  isImporting: boolean;
  teams: Array<{ id: string; name: string }> | undefined;
  isLoadingTeams: boolean;
  selectedTeamId?: string;
  onImportTypeChange: (type: ImportType) => void;
  onSelectTeam: (teamId: string | undefined) => void;
  onBack: () => void;
  onImport: () => void;
}

export function OneDriveSettingsStage({
  selectedItemCount,
  importType,
  isImporting,
  teams,
  isLoadingTeams,
  selectedTeamId,
  onImportTypeChange,
  onSelectTeam,
  onBack,
  onImport,
}: OneDriveSettingsStageProps) {
  const { t } = useT('documents');
  const { t: tCommon } = useT('common');

  const footer = (
    <HStack gap={4} className="w-full justify-stretch">
      <Button
        variant="secondary"
        onClick={onBack}
        className="flex-1"
        disabled={isImporting}
      >
        {tCommon('actions.back')}
      </Button>
      <Button onClick={onImport} className="flex-1" disabled={isImporting}>
        {isImporting ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            {importType === 'one-time'
              ? t('onedrive.importing')
              : t('onedrive.syncing')}
          </>
        ) : (
          <>
            <Database className="mr-2 size-4" />
            {importType === 'one-time'
              ? t('onedrive.importItems', { count: selectedItemCount })
              : t('onedrive.syncItems', { count: selectedItemCount })}
          </>
        )}
      </Button>
    </HStack>
  );

  return {
    title: t('onedrive.importSettings'),
    description: t('onedrive.settingsDescription', {
      count: selectedItemCount,
    }),
    footer,
    footerClassName: 'border-t border-border p-4',
    customHeader: (
      <div className="border-border flex items-start justify-between border-b px-6 py-5">
        <SectionHeader
          title={t('onedrive.importSettings')}
          description={t('onedrive.settingsDescription', {
            count: selectedItemCount,
          })}
        />
      </div>
    ),
    content: (
      <Stack gap={4} className="px-6 py-2">
        <RadioGroup
          value={importType}
          onValueChange={(value: string) => {
            const narrowed = narrowStringUnion<ImportType>(value, [
              'one-time',
              'sync',
            ] as const);
            if (narrowed) {
              onImportTypeChange(narrowed);
            }
          }}
          className="space-y-2"
        >
          <SelectableRow
            selected={importType === 'one-time'}
            onClick={() => onImportTypeChange('one-time')}
          >
            <RadioGroupItem value="one-time" id="one-time" />
            <div className="flex-1">
              <label
                htmlFor="one-time"
                className="cursor-pointer text-base font-medium"
              >
                {t('onedrive.oneTimeImport')}
              </label>
              <Description>{t('onedrive.oneTimeDescription')}</Description>
            </div>
          </SelectableRow>

          <SelectableRow
            selected={importType === 'sync'}
            onClick={() => onImportTypeChange('sync')}
          >
            <RadioGroupItem value="sync" id="sync" />
            <div className="flex-1">
              <label
                htmlFor="sync"
                className="cursor-pointer text-base font-medium"
              >
                {t('onedrive.syncImport')}
              </label>
              <Description>{t('onedrive.syncDescription')}</Description>
            </div>
          </SelectableRow>
        </RadioGroup>

        <Separator />

        <FormSection
          label={t('upload.selectTeams')}
          description={t('upload.selectTeamsDescription')}
        >
          {isLoadingTeams ? (
            <div className="flex items-center justify-center py-4">
              <Spinner size="sm" label={tCommon('actions.loading')} />
            </div>
          ) : !teams || teams.length === 0 ? (
            <EmptyPlaceholder icon={Users}>
              {t('upload.noTeamsAvailable')}
            </EmptyPlaceholder>
          ) : (
            <Select
              value={selectedTeamId ?? ORG_WIDE_TEAM}
              onValueChange={(value) =>
                onSelectTeam(value === ORG_WIDE_TEAM ? undefined : value)
              }
              disabled={isImporting}
              options={[
                {
                  value: ORG_WIDE_TEAM,
                  label: t('teamTags.orgWide'),
                },
                ...teams.map((team) => ({
                  value: team.id,
                  label: team.name,
                })),
              ]}
            />
          )}

          <Description>{t('upload.allMembersHint')}</Description>
        </FormSection>
      </Stack>
    ),
  };
}
