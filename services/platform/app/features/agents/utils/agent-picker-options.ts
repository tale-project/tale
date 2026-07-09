import type { SearchableSelectOption } from '@/app/components/ui/forms/searchable-select';
import {
  getAgentDisplayCategory,
  type AgentDisplayCategory,
  type AgentDisplayCategoryInput,
} from '@/lib/shared/agents/display-category';

export interface AgentPickerSectionLabels {
  platform: string;
  coding: string;
  image?: string;
}

export interface AgentPickerSectionInput<T> {
  platform: ReadonlyArray<T>;
  coding: ReadonlyArray<T>;
  image: ReadonlyArray<T>;
}

/** Partition agents by {@link getAgentDisplayCategory} for sectioned pickers. */
export function partitionAgentsByDisplayCategory<
  T extends AgentDisplayCategoryInput,
>(agents: ReadonlyArray<T>): AgentPickerSectionInput<T> {
  const platform: T[] = [];
  const coding: T[] = [];
  const image: T[] = [];
  for (const agent of agents) {
    switch (getAgentDisplayCategory(agent)) {
      case 'coding-agent':
        coding.push(agent);
        break;
      case 'image-agent':
        image.push(agent);
        break;
      default:
        platform.push(agent);
        break;
    }
  }
  return { platform, coding, image };
}

function sectionHeader(
  id: AgentDisplayCategory | 'platform',
  label: string,
): SearchableSelectOption {
  const value =
    id === 'platform' || id === 'agent'
      ? '__section:agents'
      : id === 'coding-agent'
        ? '__section:coding-agents'
        : '__section:image-agents';
  return {
    value,
    label,
    isSectionHeader: true,
  };
}

/**
 * Build a flat {@link SearchableSelectOption} list with non-selectable section
 * headers separating platform agents, coding agents, and (optionally) image
 * agents. Used by chat, project, and task assignee pickers.
 */
export function buildAgentSectionOptions<T extends AgentDisplayCategoryInput>(
  agents: ReadonlyArray<T>,
  toOption: (agent: T) => SearchableSelectOption,
  labels: AgentPickerSectionLabels,
  sortWithinSection?: (section: T[]) => T[],
): SearchableSelectOption[] {
  const sort = sortWithinSection ?? ((section: T[]) => [...section]);
  const { platform, coding, image } = partitionAgentsByDisplayCategory(agents);
  const out: SearchableSelectOption[] = [];

  if (platform.length > 0) {
    out.push(sectionHeader('platform', labels.platform));
    out.push(...sort([...platform]).map(toOption));
  }
  if (coding.length > 0) {
    out.push(sectionHeader('coding-agent', labels.coding));
    out.push(...sort([...coding]).map(toOption));
  }
  if (image.length > 0 && labels.image) {
    out.push(sectionHeader('image-agent', labels.image));
    out.push(...sort([...image]).map(toOption));
  }

  return out;
}

/** Drop section headers whose following block has no remaining selectable rows. */
export function pruneEmptyAgentSections(
  options: ReadonlyArray<SearchableSelectOption>,
): SearchableSelectOption[] {
  const out: SearchableSelectOption[] = [];
  let pendingHeader: SearchableSelectOption | null = null;

  for (const option of options) {
    if (option.isSectionHeader) {
      pendingHeader = option;
      continue;
    }
    if (pendingHeader) {
      out.push(pendingHeader);
      pendingHeader = null;
    }
    out.push(option);
  }

  return out;
}
