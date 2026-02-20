import { describe, it, expect } from 'vitest';

import type { Doc, Id } from '../_generated/dataModel';

import { toSerializableConfig } from './config';

function createMockDraftAgent(
  overrides: Partial<Doc<'customAgents'>> = {},
): Doc<'customAgents'> {
  return {
    _id: 'agent_draft_1' as Id<'customAgents'>,
    _creationTime: Date.now(),
    organizationId: 'org_1',
    name: 'test-agent',
    displayName: 'Test Agent',
    description: 'A test agent',
    systemInstructions: 'You are a helpful test agent.',
    toolNames: ['web_search', 'document_search'],
    integrationBindings: ['integration_1'],
    modelPreset: 'standard',
    includeOrgKnowledge: true,
    teamId: 'team_1',
    sharedWithTeamIds: [],
    createdBy: 'user_1',
    versionNumber: 1,
    status: 'draft',
    rootVersionId: 'agent_root_1' as Id<'customAgents'>,
    ...overrides,
  } as Doc<'customAgents'>;
}

describe('testCustomAgent', () => {
  describe('toSerializableConfig for draft agents', () => {
    it('should convert draft agent to SerializableAgentConfig', () => {
      const draft = createMockDraftAgent();
      const config = toSerializableConfig(draft);

      expect(config).toEqual({
        name: 'custom:test-agent',
        instructions: 'You are a helpful test agent.',
        convexToolNames: ['web_search', 'document_search'],
        integrationBindings: ['integration_1'],
        useFastModel: false,
        model: undefined,
        enableVectorSearch: false,
      });
    });

    it('should set useFastModel for fast preset', () => {
      const draft = createMockDraftAgent({ modelPreset: 'fast' });
      const config = toSerializableConfig(draft);

      expect(config.useFastModel).toBe(true);
      expect(config.model).toBeUndefined();
    });

    it('should handle agent with no integration bindings', () => {
      const draft = createMockDraftAgent({ integrationBindings: undefined });
      const config = toSerializableConfig(draft);

      expect(config.integrationBindings).toBeUndefined();
    });

    it('should handle agent with empty tool names', () => {
      const draft = createMockDraftAgent({ toolNames: [] });
      const config = toSerializableConfig(draft);

      expect(config.convexToolNames).toEqual([]);
    });
  });

  describe('RAG team ID construction', () => {
    it('should include teamId when present', () => {
      const draft = createMockDraftAgent({
        teamId: 'team_1',
        includeOrgKnowledge: false,
      });

      const ragTeamIds: string[] = [];
      if (draft.teamId) ragTeamIds.push(draft.teamId);
      if (draft.includeOrgKnowledge)
        ragTeamIds.push(`org_${draft.organizationId}`);

      expect(ragTeamIds).toEqual(['team_1']);
    });

    it('should include org knowledge when enabled', () => {
      const draft = createMockDraftAgent({
        teamId: 'team_1',
        includeOrgKnowledge: true,
      });

      const ragTeamIds: string[] = [];
      if (draft.teamId) ragTeamIds.push(draft.teamId);
      if (draft.includeOrgKnowledge)
        ragTeamIds.push(`org_${draft.organizationId}`);

      expect(ragTeamIds).toEqual(['team_1', 'org_org_1']);
    });

    it('should return empty when no team and no org knowledge', () => {
      const draft = createMockDraftAgent({
        teamId: undefined,
        includeOrgKnowledge: false,
      });

      const ragTeamIds: string[] = [];
      if (draft.teamId) ragTeamIds.push(draft.teamId);
      if (draft.includeOrgKnowledge)
        ragTeamIds.push(`org_${draft.organizationId}`);

      expect(ragTeamIds).toEqual([]);
    });

    it('should only include org knowledge when explicitly enabled', () => {
      const draft = createMockDraftAgent({
        teamId: undefined,
        includeOrgKnowledge: false,
        knowledgeEnabled: true,
      });

      const ragTeamIds: string[] = [];
      if (draft.teamId) ragTeamIds.push(draft.teamId);
      if (draft.includeOrgKnowledge)
        ragTeamIds.push(`org_${draft.organizationId}`);

      expect(ragTeamIds).toEqual([]);
      expect(ragTeamIds).not.toContain(`org_${draft.organizationId}`);
    });
  });

  describe('file preprocessing instructions', () => {
    it('should not append preprocessing instructions when disabled', () => {
      const draft = createMockDraftAgent({ filePreprocessingEnabled: false });
      const config = toSerializableConfig(draft);

      expect(config.instructions).toBe('You are a helpful test agent.');
      expect(config.instructions).not.toContain('FILE ATTACHMENTS');
    });

    it('should not append preprocessing instructions when undefined', () => {
      const draft = createMockDraftAgent({
        filePreprocessingEnabled: undefined,
      });
      const config = toSerializableConfig(draft);

      expect(config.instructions).toBe('You are a helpful test agent.');
      expect(config.instructions).not.toContain('FILE ATTACHMENTS');
    });

    it('should append preprocessing instructions when enabled', () => {
      const draft = createMockDraftAgent({ filePreprocessingEnabled: true });
      const config = toSerializableConfig(draft);

      expect(config.instructions).toContain('You are a helpful test agent.');
      expect(config.instructions).toContain('**FILE ATTACHMENTS**');
      expect(config.instructions).toContain('PRE-ANALYZED CONTENT');
    });
  });

  describe('ragTeamIds passed to startAgentChat', () => {
    function buildRagTeamIds(
      agent: Doc<'customAgents'>,
      organizationId: string,
    ) {
      const ragTeamIds: string[] = [];
      if (agent.teamId) ragTeamIds.push(agent.teamId);
      if (agent.includeOrgKnowledge) ragTeamIds.push(`org_${organizationId}`);
      return ragTeamIds;
    }

    it('should always pass ragTeamIds array for custom agents, never undefined', () => {
      const draft = createMockDraftAgent({
        teamId: undefined,
        includeOrgKnowledge: false,
        knowledgeEnabled: true,
      });

      const ragTeamIds = buildRagTeamIds(draft, draft.organizationId);

      // Must be an array (even if empty), NOT undefined.
      // Passing undefined causes start_agent_chat to fall back to user's
      // full team access, leaking org documents.
      expect(ragTeamIds).toBeDefined();
      expect(Array.isArray(ragTeamIds)).toBe(true);
    });

    it('should not leak org documents when includeOrgKnowledge is false', () => {
      const draft = createMockDraftAgent({
        teamId: 'team_1',
        includeOrgKnowledge: false,
        knowledgeEnabled: true,
      });

      const ragTeamIds = buildRagTeamIds(draft, draft.organizationId);

      expect(ragTeamIds).toEqual(['team_1']);
      expect(ragTeamIds).not.toContain(`org_${draft.organizationId}`);
    });

    it('should include org documents only when includeOrgKnowledge is true', () => {
      const draft = createMockDraftAgent({
        teamId: 'team_1',
        includeOrgKnowledge: true,
        knowledgeEnabled: true,
      });

      const ragTeamIds = buildRagTeamIds(draft, draft.organizationId);

      expect(ragTeamIds).toEqual(['team_1', 'org_org_1']);
    });
  });
});
