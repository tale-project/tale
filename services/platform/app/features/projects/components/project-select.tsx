'use client';

import {
  SearchableSelect,
  type SearchableSelectOption,
  type SearchableSelectProps,
} from '@tale/ui/searchable-select';

import { useProjectSelect } from '../hooks/use-project-select';

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
 * what is typed, the server's name search past it, never every project
 * (#5204): {@link useProjectSelect}. The project picked stays named once the
 * search moves on, and a value the offer lacks (a project past the page) is
 * read by id.
 */
export function ProjectSelect({
  organizationId,
  value,
  onValueChange,
  leadingOptions,
  ...field
}: ProjectSelectProps) {
  const select = useProjectSelect({
    organizationId,
    value,
    onValueChange,
    ...(leadingOptions !== undefined && { leadingOptions }),
  });
  return (
    <SearchableSelect
      {...field}
      value={value}
      options={select.options}
      onSearchChange={select.onSearchChange}
      onValueChange={select.onValueChange}
    />
  );
}
