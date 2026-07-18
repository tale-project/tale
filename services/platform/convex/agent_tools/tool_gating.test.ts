import { describe, expect, it } from 'vitest';

import {
  computeActiveToolNames,
  CORE_TOOL_NAMES,
  createToolGatingState,
  GATED_TOOL_GROUPS,
  hydrateToolGatingState,
  lockedGroupsFor,
  REQUEST_CAPABILITIES_TOOL_NAME,
} from './tool_gating';
import { TOOL_NAMES } from './tool_names';

/** The default chat assistant's bound tools (builtin-configs assistant.json). */
const ASSISTANT_TOOLS = [
  'rag_search',
  'web',
  'document_retrieve',
  'document_find',
  'document_write',
  'image',
  'generate_image',
  'request_human_input',
  'file_write',
  'file_edit',
  'file_read',
  'file_list',
  'run_code',
  'request_user_location',
  'file_delete',
];

describe('tool gating groups', () => {
  it('every grouped tool is a registry tool name or a known extra', () => {
    const KNOWN_EXTRAS = ['spawn_agent'];
    for (const group of GATED_TOOL_GROUPS) {
      for (const tool of group.tools) {
        expect([...TOOL_NAMES, ...KNOWN_EXTRAS]).toContain(tool);
      }
    }
  });

  it('core and gated sets are disjoint — a core tool may never be locked', () => {
    const grouped = new Set(GATED_TOOL_GROUPS.flatMap((g) => [...g.tools]));
    for (const core of CORE_TOOL_NAMES) {
      expect(grouped.has(core)).toBe(false);
    }
  });

  it('no tool belongs to two groups', () => {
    const all = GATED_TOOL_GROUPS.flatMap((g) => [...g.tools]);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('computeActiveToolNames', () => {
  it('locks the gated groups and offers the meta-tool on a fresh state', () => {
    const active = computeActiveToolNames(
      ASSISTANT_TOOLS,
      createToolGatingState(),
    );
    expect(active).toContain('rag_search');
    expect(active).toContain('web');
    expect(active).toContain('request_human_input');
    expect(active).toContain(REQUEST_CAPABILITIES_TOOL_NAME);
    expect(active).not.toContain('run_code');
    expect(active).not.toContain('file_write');
    expect(active).not.toContain('generate_image');
    expect(active).not.toContain('document_write');
    expect(active).not.toContain('request_user_location');
  });

  it('an unlock activates exactly that group on the next computation', () => {
    const state = createToolGatingState();
    state.unlockedGroupIds.add('workspace');
    const active = computeActiveToolNames(ASSISTANT_TOOLS, state);
    expect(active).toContain('run_code');
    expect(active).toContain('file_delete');
    expect(active).not.toContain('generate_image');
    // Other groups remain locked → the meta-tool stays offered.
    expect(active).toContain(REQUEST_CAPABILITIES_TOOL_NAME);
  });

  it('drops the meta-tool once every relevant group is unlocked', () => {
    const state = createToolGatingState();
    for (const g of GATED_TOOL_GROUPS) state.unlockedGroupIds.add(g.id);
    const active = computeActiveToolNames(ASSISTANT_TOOLS, state);
    expect(active).not.toContain(REQUEST_CAPABILITIES_TOOL_NAME);
    expect(active.sort()).toEqual([...ASSISTANT_TOOLS].sort());
  });

  it('ungrouped tools (specialist agents, extras) always stay active', () => {
    const names = ['contact_read', 'workflow_read', 'mcp_custom_tool'];
    const active = computeActiveToolNames(names, createToolGatingState());
    expect(active).toEqual(expect.arrayContaining(names));
    // Nothing lockable bound → no meta-tool either.
    expect(active).not.toContain(REQUEST_CAPABILITIES_TOOL_NAME);
  });
});

describe('hydrateToolGatingState', () => {
  it('folds persisted unlocks in and ignores unknown ids', () => {
    const state = createToolGatingState();
    hydrateToolGatingState(state, ['images', 'no-such-group']);
    expect(state.unlockedGroupIds.has('images')).toBe(true);
    expect(state.unlockedGroupIds.has('no-such-group')).toBe(false);
  });

  it('tolerates an absent persisted list', () => {
    const state = createToolGatingState();
    hydrateToolGatingState(state, undefined);
    expect(state.unlockedGroupIds.size).toBe(0);
  });
});

describe('lockedGroupsFor', () => {
  it('only advertises groups whose tools this agent actually binds', () => {
    const locked = lockedGroupsFor(
      ['rag_search', 'run_code', 'file_write'],
      createToolGatingState(),
    );
    expect(locked.map((g) => g.id)).toEqual(['workspace']);
  });
});
