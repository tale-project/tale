'use client';

import { Plus, Trash2 } from 'lucide-react';

import type {
  PlatformRole,
  RoleMappingRule,
} from '@/lib/shared/schemas/sso_providers';

import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';

interface RoleMappingSectionProps {
  rules: RoleMappingRule[];
  platformRoles: { value: PlatformRole; label: string }[];
  disabled: boolean;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, updates: Partial<RoleMappingRule>) => void;
}

export function RoleMappingSection({
  rules,
  platformRoles,
  disabled,
  onAdd,
  onRemove,
  onUpdate,
}: RoleMappingSectionProps) {
  const { t } = useT('settings');

  return (
    <FormSection
      label={t('integrations.sso.roleMappingRulesLabel')}
      description={t('integrations.sso.roleMappingRulesHelp')}
    >
      <Stack gap={0} className="divide-border divide-y">
        {rules.map((rule, index) => (
          <HStack
            key={index}
            gap={2}
            align="center"
            className="flex-wrap py-3 first:pt-0 last:pb-0"
          >
            <Select
              value={rule.source}
              onValueChange={(value) =>
                onUpdate(index, {
                  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Radix Select onValueChange returns string
                  source: value as 'jobTitle' | 'appRole',
                })
              }
              disabled={disabled}
              className="w-28 shrink-0"
              options={[
                {
                  value: 'jobTitle',
                  label: t('integrations.sso.sourceJobTitle'),
                },
                {
                  value: 'appRole',
                  label: t('integrations.sso.sourceAppRole'),
                },
              ]}
            />

            <Input
              placeholder="*developer*"
              value={rule.pattern}
              onChange={(e) => onUpdate(index, { pattern: e.target.value })}
              disabled={disabled}
              className="min-w-32 flex-1"
            />

            <Select
              value={rule.targetRole}
              onValueChange={(value) =>
                onUpdate(index, {
                  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Radix Select onValueChange returns string
                  targetRole: value as PlatformRole,
                })
              }
              disabled={disabled}
              className="w-28 shrink-0"
              options={platformRoles}
            />

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onRemove(index)}
              disabled={disabled}
              className="shrink-0"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </HStack>
        ))}

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onAdd}
          disabled={disabled}
        >
          <Plus className="mr-2 h-4 w-4" />
          {t('integrations.sso.addRule')}
        </Button>
      </Stack>
    </FormSection>
  );
}
