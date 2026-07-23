'use client';

import { Checkbox } from '@tale/ui/checkbox';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import { RadioGroup } from '@/app/components/ui/forms/radio-group';
import { useT } from '@/lib/i18n/client';

/** The three states an agent allowlist can be in (see lib/agents/resolve.ts):
 * ABSENT = not narrowed, EMPTY = nothing, a list = exactly those ids. */
export type AllowlistMode = 'all' | 'none' | 'selected';

export interface AllowlistOption {
  id: string;
  label: string;
  description?: string;
  /** In the agent's file but not in today's catalog — kept unless unchecked. */
  unknown?: boolean;
}

export function allowlistModeOf(list: string[] | undefined): AllowlistMode {
  if (list === undefined) return 'all';
  return list.length === 0 ? 'none' : 'selected';
}

/** What to persist for a mode: `null` clears the narrowing, `[]` narrows to
 * nothing, a list narrows to it. */
export function allowlistValueFor(
  mode: AllowlistMode,
  selected: readonly string[],
): string[] | null {
  if (mode === 'all') return null;
  if (mode === 'none') return [];
  return [...selected];
}

/**
 * The tri-state allowlist editor both binding tabs share: a mode radio
 * (all / none / selected) and — in `selected` mode — a checkbox per option.
 * Ids already in the agent's file but missing from today's catalog render as
 * "kept" entries so a save never silently drops what the file says.
 */
export function AllowlistEditor({
  mode,
  onModeChange,
  options,
  selected,
  onToggle,
  labelKeyPrefix,
  emptyCatalogText,
  disabled,
  counter,
}: {
  mode: AllowlistMode;
  onModeChange: (mode: AllowlistMode) => void;
  options: readonly AllowlistOption[];
  selected: ReadonlySet<string>;
  onToggle: (id: string, checked: boolean) => void;
  /** i18n prefix under `settings.agents.allowlist` — `tools` or `skills`. */
  labelKeyPrefix: 'tools' | 'skills';
  emptyCatalogText: string;
  disabled?: boolean;
  /** Optional "n of max" line under the list (the skills cap). */
  counter?: string;
}) {
  const { t } = useT('settings');
  const prefix = `agents.allowlist.${labelKeyPrefix}`;

  return (
    <Stack gap={3}>
      <RadioGroup
        aria-label={t(`${prefix}Label`)}
        value={mode}
        onValueChange={(next) => {
          if (next === 'all' || next === 'none' || next === 'selected') {
            onModeChange(next);
          }
        }}
        options={[
          {
            value: 'all',
            label: t(`${prefix}All`),
            description: t(`${prefix}AllHelp`),
          },
          {
            value: 'none',
            label: t(`${prefix}None`),
            description: t(`${prefix}NoneHelp`),
          },
          {
            value: 'selected',
            label: t(`${prefix}Selected`),
            description: t(`${prefix}SelectedHelp`),
          },
        ]}
        disabled={disabled}
      />

      {mode === 'selected' && (
        <Stack gap={2} className="pl-1">
          {options.length === 0 ? (
            <Text as="p" variant="muted" className="text-sm">
              {emptyCatalogText}
            </Text>
          ) : (
            <Stack as="ul" gap={2}>
              {options.map((option) => (
                <li key={option.id} className="flex items-start gap-2">
                  <Checkbox
                    id={`allowlist-${labelKeyPrefix}-${option.id}`}
                    checked={selected.has(option.id)}
                    onCheckedChange={(checked) =>
                      onToggle(option.id, checked === true)
                    }
                    disabled={disabled}
                  />
                  <label
                    htmlFor={`allowlist-${labelKeyPrefix}-${option.id}`}
                    className="min-w-0 cursor-pointer"
                  >
                    <span className="block text-sm font-medium">
                      {option.label}
                    </span>
                    {option.unknown ? (
                      <span className="text-muted-foreground block text-xs italic">
                        {t('agents.allowlist.unknownKept')}
                      </span>
                    ) : option.description ? (
                      <span className="text-muted-foreground block text-xs">
                        {option.description}
                      </span>
                    ) : null}
                  </label>
                </li>
              ))}
            </Stack>
          )}
          {counter && (
            <Text as="p" variant="muted" className="text-xs">
              {counter}
            </Text>
          )}
        </Stack>
      )}
    </Stack>
  );
}
