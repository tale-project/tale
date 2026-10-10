import { useMemo } from 'react';

import type { SkillOption } from '@/app/components/skills/skills-menu';
import {
  AGENT_TOOL_CATALOG,
  PROJECT_AGENT_ONLY_TOOLS,
} from '@/backend/core/sandbox/tool_names';
import { useT } from '@/lib/i18n/client';

/**
 * The platform tools an equipment menu offers an agent, labelled with the
 * read/write badge and grouped by module (Tasks, Documents, Knowledge, …),
 * plus the capabilities every agent has without a grant — knowledge search,
 * the baseline of every managed turn — as locked rows in their module.
 *
 * `project` is a project agent's menu; `automation` is an automation agent
 * step's, which never offers the project-agent-only tools (an automation
 * starts agents with its `task.start_agent` step instead).
 */
export function useAgentToolOptions(lane: 'project' | 'automation'): {
  tools: readonly SkillOption[];
  lockedTools: readonly SkillOption[];
} {
  const { t } = useT('projects');
  return useMemo(() => {
    const tools = AGENT_TOOL_CATALOG.filter(
      (tool) =>
        lane === 'project' || !PROJECT_AGENT_ONLY_TOOLS.includes(tool.name),
    ).map((tool) => ({
      slug: tool.name,
      label: t(`agents.tool.${tool.name}`, { defaultValue: tool.name }),
      description: t(
        tool.effect === 'write'
          ? 'agents.tool.writeBadge'
          : 'agents.tool.readBadge',
      ),
      group: t(`agents.tool.module.${tool.module}`),
    }));
    const lockedTools: SkillOption[] = [
      {
        slug: 'knowledge_search',
        label: t('agents.tool.knowledge_search'),
        description: t('agents.tool.alwaysOn'),
        group: t('agents.tool.module.knowledge'),
      },
    ];
    return { tools, lockedTools };
  }, [lane, t]);
}
