'use client';

import { Button } from '@tale/ui/button';
import { Description } from '@tale/ui/description';
import { EmptyPlaceholder } from '@tale/ui/empty-placeholder';
import { HStack, Row, Stack } from '@tale/ui/layout';
import { SectionHeader } from '@tale/ui/section-header';
import { SelectableRow } from '@tale/ui/selectable-row';
import { Separator } from '@tale/ui/separator';
import { Spinner } from '@tale/ui/spinner';
import type { TFunction } from 'i18next';
import { Database, Loader2, Users } from 'lucide-react';

import { FormSection } from '@/app/components/ui/forms/form-section';
import {
  RadioGroup,
  RadioGroupItem,
} from '@/app/components/ui/forms/radio-group';
import { Select } from '@/app/components/ui/forms/select';
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
  /** `documents`-namespace translator, owned by the dialog. This stage is a
   *  plain function (not a component), so it must not call hooks itself —
   *  the picker↔settings switch would change the parent's hook count. */
  t: TFunction;
  /** `common`-namespace translator, owned by the dialog. */
  tCommon: TFunction;
  /**
   * Message-key prefix under the documents catalog (`onedrive` or
   * `googledrive`). Both providers share the same settings shape.
   */
  messagePrefix?: 'onedrive' | 'googledrive';
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
  t,
  tCommon,
  messagePrefix = 'onedrive',
  onImportTypeChange,
  onSelectTeam,
  onBack,
  onImport,
}: OneDriveSettingsStageProps) {
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
              ? t(`${messagePrefix}.importing`)
              : t(`${messagePrefix}.syncing`)}
          </>
        ) : (
          <>
            <Database className="mr-2 size-4" />
            {importType === 'one-time'
              ? t(`${messagePrefix}.importItems`, { count: selectedItemCount })
              : t(`${messagePrefix}.syncItems`, { count: selectedItemCount })}
          </>
        )}
      </Button>
    </HStack>
  );

  return {
    title: t(`${messagePrefix}.importSettings`),
    description: t(`${messagePrefix}.settingsDescription`, {
      count: selectedItemCount,
    }),
    footer,
    footerClassName: 'border-t border-border p-4',
    customHeader: (
      <Row
        gap={0}
        align="start"
        justify="between"
        className="border-border border-b px-6 py-5"
      >
        <SectionHeader
          title={t(`${messagePrefix}.importSettings`)}
          description={t(`${messagePrefix}.settingsDescription`, {
            count: selectedItemCount,
          })}
        />
      </Row>
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
                {t(`${messagePrefix}.oneTimeImport`)}
              </label>
              <Description>
                {t(`${messagePrefix}.oneTimeDescription`)}
              </Description>
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
                {t(`${messagePrefix}.syncImport`)}
              </label>
              <Description>{t(`${messagePrefix}.syncDescription`)}</Description>
            </div>
          </SelectableRow>
        </RadioGroup>

        <Separator />

        <FormSection
          label={t('upload.selectTeams')}
          description={t('upload.selectTeamsDescription')}
        >
          {isLoadingTeams ? (
            <Row gap={0} justify="center" className="py-4">
              <Spinner size="sm" label={tCommon('actions.loading')} />
            </Row>
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
