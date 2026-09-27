'use client';

import {
  PROJECT_COLORS,
  PROJECT_ICONS,
  type ProjectColor,
  type ProjectIcon,
} from '@tale/shared/schemas/projects';
import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { Popover } from '@tale/ui/popover';
import { useId, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';

import { ProjectAvatar } from './project-avatar';

/** Grid width of both option grids; ↑/↓ move by one row. */
const COLUMNS = 8;

/** The pair the picker edits; `null` means "the default" on both. */
export interface ProjectIdentityValue {
  readonly icon: string | null;
  readonly color: string | null;
}

function isProjectColor(value: string | null): value is ProjectColor {
  return (
    value !== null && (PROJECT_COLORS as readonly string[]).includes(value)
  );
}

function isProjectIcon(value: string | null): value is ProjectIcon {
  return value !== null && (PROJECT_ICONS as readonly string[]).includes(value);
}

/**
 * One option grid with radio semantics: a single tab stop, the arrow keys
 * move focus AND selection (like native radios), Home/End jump to the ends.
 */
function OptionGrid<T extends string>({
  labelId,
  options,
  selected,
  onSelect,
  optionLabel,
  renderOption,
}: {
  labelId: string;
  options: readonly T[];
  selected: T;
  onSelect: (value: T) => void;
  optionLabel: (value: T) => string;
  renderOption: (value: T, isSelected: boolean) => React.ReactNode;
}) {
  const buttonsRef = useRef<Map<T, HTMLButtonElement>>(new Map());

  const moveTo = (index: number) => {
    const clamped = Math.min(options.length - 1, Math.max(0, index));
    const next = options[clamped];
    if (next === undefined) return;
    onSelect(next);
    buttonsRef.current.get(next)?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    const moves: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: COLUMNS,
      ArrowUp: -COLUMNS,
    };
    const delta = moves[e.key];
    if (delta !== undefined) {
      e.preventDefault();
      moveTo(index + delta);
    } else if (e.key === 'Home') {
      e.preventDefault();
      moveTo(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      moveTo(options.length - 1);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      className="grid grid-cols-8 gap-1"
    >
      {options.map((option, index) => {
        const isSelected = option === selected;
        return (
          <button
            key={option}
            ref={(node) => {
              if (node) buttonsRef.current.set(option, node);
              else buttonsRef.current.delete(option);
            }}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={optionLabel(option)}
            title={optionLabel(option)}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onSelect(option)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={cn(
              'focus-visible:ring-ring flex size-8 items-center justify-center rounded-md outline-none focus-visible:ring-2',
              isSelected ? 'ring-ring ring-2' : 'hover:bg-accent',
            )}
          >
            {renderOption(option, isSelected)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The project's icon and color, edited together in one popover: a color row
 * and an icon grid, each a radio group over the server's allowlist
 * (`PROJECT_ICONS` / `PROJECT_COLORS`), previewed live in the trigger's
 * avatar. Controlled — the owner holds the form state and the save wiring.
 */
export function ProjectIdentityPicker({
  name,
  value,
  onChange,
  disabled,
}: {
  /** The project name — the avatar's accessible name. */
  name: string;
  value: ProjectIdentityValue;
  onChange: (value: ProjectIdentityValue) => void;
  disabled?: boolean;
}) {
  const { t } = useT('projects');
  const [open, setOpen] = useState(false);
  const colorLabelId = useId();
  const iconLabelId = useId();

  const selectedColor: ProjectColor = isProjectColor(value.color)
    ? value.color
    : 'gray';
  const selectedIcon: ProjectIcon = isProjectIcon(value.icon)
    ? value.icon
    : 'Folder';

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      modal
      aria-label={t('identity.label')}
      contentClassName="w-80 max-w-none"
      trigger={
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          fullWidth
          className="justify-start gap-2"
        >
          <ProjectAvatar
            name={name}
            icon={value.icon}
            color={value.color}
            size={20}
          />
          {t('identity.trigger')}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <p id={colorLabelId} className="text-xs font-medium">
            {t('identity.colorLabel')}
          </p>
          <OptionGrid
            labelId={colorLabelId}
            options={PROJECT_COLORS}
            selected={selectedColor}
            onSelect={(color) => onChange({ ...value, color })}
            optionLabel={(color) => t(`identity.colors.${color}`)}
            renderOption={(color) => (
              <ProjectAvatar
                name={t(`identity.colors.${color}`)}
                icon={selectedIcon}
                color={color}
                size={24}
              />
            )}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <p id={iconLabelId} className="text-xs font-medium">
            {t('identity.iconLabel')}
          </p>
          <OptionGrid
            labelId={iconLabelId}
            options={PROJECT_ICONS}
            selected={selectedIcon}
            onSelect={(icon) => onChange({ ...value, icon })}
            optionLabel={(icon) => t(`identity.icons.${icon}`)}
            renderOption={(icon, isSelected) => (
              <ProjectAvatar
                name={t(`identity.icons.${icon}`)}
                icon={icon}
                color={selectedColor}
                size={24}
                variant={isSelected ? 'filled' : 'plain'}
              />
            )}
          />
        </div>
      </div>
    </Popover>
  );
}
