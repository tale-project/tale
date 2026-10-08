import type { ProjectAgentRow } from '../hooks/queries';

/** Read-only configuration shared by the project tab and task actor previews.
 * Credential grants and internal identifiers do not travel into the preview. */
export type ProjectAgentDetails = Pick<
  ProjectAgentRow,
  | 'name'
  | 'organizationId'
  | 'projectId'
  | 'harness'
  | 'model'
  | 'modelProvider'
  | 'skills'
  | 'connectors'
  | 'tools'
  | 'instructions'
  | 'managed'
>;

export function projectAgentDetails(
  agent: ProjectAgentRow,
): ProjectAgentDetails {
  return {
    name: agent.name,
    organizationId: agent.organizationId,
    projectId: agent.projectId,
    harness: agent.harness,
    model: agent.model,
    modelProvider: agent.modelProvider,
    skills: agent.skills,
    connectors: agent.connectors,
    tools: agent.tools,
    instructions: agent.instructions,
    managed: agent.managed,
  };
}
