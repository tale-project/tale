'use client';

import {
  SearchableSelect,
  type SearchableSelectOption,
  type SearchableSelectProps,
} from '@tale/ui/searchable-select';
import { useCallback, useMemo, useState } from 'react';

import {
  type ProjectChoice,
  useNamedProjects,
  useProjectChoices,
} from '../hooks/queries';

const NO_LEADING_OPTIONS: readonly SearchableSelectOption[] = [];
const NO_PROJECT_IDS: readonly string[] = [];

export interface ProjectSelectProps extends Omit<
  SearchableSelectProps,
  'options' | 'value' | 'onValueChange' | 'onSearchChange'
> {
  organizationId: string;
  /** The picked project's id, or the value of a leading option. */
  value: string | null;
  onValueChange: (value: string) => void;
  /** What the field offers above the projects, such as the organization. */
  leadingOptions?: readonly SearchableSelectOption[];
}

/**
 * A field that picks one project. It offers Home's page of projects and, for
 * what is typed, the server's name search past it ({@link useProjectChoices}),
 * never every project (#5204). The project picked stays named once the search
 * moves on, and a value the offer lacks (a project past the page) is read by
 * id.
 */
export function ProjectSelect({
  organizationId,
  value,
  onValueChange,
  leadingOptions = NO_LEADING_OPTIONS,
  ...field
}: ProjectSelectProps) {
  const [query, setQuery] = useState('');
  const { projects } = useProjectChoices(organizationId, query);
  // A search hit leaves the offer when the search box resets on close.
  const [picked, setPicked] = useState<ProjectChoice | null>(null);
  const projectId =
    value !== null && !leadingOptions.some((option) => option.value === value)
      ? value
      : null;
  const offered =
    projectId !== null && projects.some((project) => project._id === projectId);
  const pickedHere = picked !== null && picked._id === projectId;
  const named = useNamedProjects(
    organizationId,
    projectId === null || offered || pickedHere ? NO_PROJECT_IDS : [projectId],
  );
  const kept =
    projectId === null || offered
      ? undefined
      : pickedHere
        ? picked
        : named.projects.get(projectId);
  const options = useMemo(
    () => [
      ...leadingOptions,
      ...projects.map((project) => ({
        value: project._id,
        label: project.name,
      })),
      ...(kept === undefined ? [] : [{ value: kept._id, label: kept.name }]),
    ],
    [leadingOptions, projects, kept],
  );
  const pick = useCallback(
    (next: string) => {
      setPicked(
        projects.find((project) => project._id === next) ??
          (kept?._id === next ? kept : null),
      );
      onValueChange(next);
    },
    [projects, kept, onValueChange],
  );
  return (
    <SearchableSelect
      {...field}
      value={value}
      options={options}
      onSearchChange={setQuery}
      onValueChange={pick}
    />
  );
}
