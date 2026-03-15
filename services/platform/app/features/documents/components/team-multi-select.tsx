'use client';

import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useState, useCallback, useRef, useEffect } from 'react';

import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { cn } from '@/lib/utils/cn';

interface Team {
  id: string;
  name: string;
}

interface TeamMultiSelectProps {
  teams: Team[];
  selectedTeamIds: string[];
  onSelectionChange: (teamIds: string[]) => void;
  orgWideLabel: string;
  disabled?: boolean;
}

export function TeamMultiSelect({
  teams,
  selectedTeamIds,
  onSelectionChange,
  orgWideLabel,
  disabled,
}: TeamMultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleTeam = useCallback(
    (teamId: string) => {
      if (selectedTeamIds.includes(teamId)) {
        onSelectionChange(selectedTeamIds.filter((id) => id !== teamId));
      } else {
        onSelectionChange([...selectedTeamIds, teamId]);
      }
    },
    [selectedTeamIds, onSelectionChange],
  );

  const removeTeam = useCallback(
    (teamId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      onSelectionChange(selectedTeamIds.filter((id) => id !== teamId));
    },
    [selectedTeamIds, onSelectionChange],
  );

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        e.target instanceof Node &&
        !containerRef.current.contains(e.target)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const selectedTeams = teams.filter((t) => selectedTeamIds.includes(t.id));
  const ChevronIcon = isOpen ? ChevronUp : ChevronDown;

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() =>
          !disabled && teams.length > 0 && setIsOpen((prev) => !prev)
        }
        disabled={disabled || teams.length === 0}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className={cn(
          'flex w-full items-center gap-1.5 rounded-lg border bg-background px-3 py-2 text-sm shadow-xs transition-colors',
          isOpen
            ? 'border-primary ring-2 ring-primary/20'
            : 'border-border hover:border-border/80',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <div className="flex flex-1 flex-wrap items-center gap-1.5">
          {selectedTeams.length === 0 ? (
            <span className="bg-muted inline-flex items-center rounded px-2 py-0.5 text-xs font-medium">
              {orgWideLabel}
            </span>
          ) : (
            selectedTeams.map((team) => (
              <span
                key={team.id}
                className="bg-muted inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium"
              >
                {team.name}
                <button
                  type="button"
                  onClick={(e) => removeTeam(team.id, e)}
                  className="text-muted-foreground hover:text-foreground -mr-0.5 rounded-sm"
                  aria-label={`Remove ${team.name}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))
          )}
        </div>
        <ChevronIcon
          className={cn(
            'size-4 shrink-0',
            isOpen ? 'text-primary' : 'text-muted-foreground',
          )}
        />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="ring-border bg-popover absolute top-full left-0 z-50 mt-1 w-full overflow-hidden rounded-lg p-1 shadow-lg ring-1"
        >
          {teams.map((team) => {
            const isSelected = selectedTeamIds.includes(team.id);
            return (
              <button
                key={team.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => toggleTeam(team.id)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                  isSelected
                    ? 'bg-muted font-medium'
                    : 'hover:bg-muted/50 font-normal',
                )}
              >
                <Checkbox
                  checked={isSelected}
                  tabIndex={-1}
                  aria-hidden="true"
                />
                <span className="text-foreground">{team.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
