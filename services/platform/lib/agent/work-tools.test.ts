import { describe, expect, it } from 'vitest';

import { isRecord } from '../utils/type-utils';
import {
  isWorkToolName,
  RUN_CODE_LANGUAGES,
  RUN_CODE_MAX_TIMEOUT_SECONDS,
  WORK_TOOL_NAMES,
  workToolDoc,
  workToolTier,
  workWireTool,
} from './work-tools';

function schemaOf(name: (typeof WORK_TOOL_NAMES)[number]) {
  const parameters = workWireTool(name).parameters;
  if (!isRecord(parameters)) throw new Error('schema is not an object');
  return parameters;
}

describe('work tools', () => {
  it('every tool has a closed object schema, a description and a doc line', () => {
    for (const name of WORK_TOOL_NAMES) {
      const schema = schemaOf(name);
      expect(schema.type).toBe('object');
      expect(schema.additionalProperties).toBe(false);
      expect(workWireTool(name).description.length).toBeGreaterThan(80);
      expect(workToolDoc(name).id).toBe(name);
    }
  });

  it('each tool runs in its tier: the platform, a light sandbox, or the full workspace', () => {
    const tiers = Object.fromEntries(
      WORK_TOOL_NAMES.map((name) => [name, workToolTier(name)]),
    );
    expect(tiers).toEqual({
      create_file: 'none',
      generate_image: 'none',
      load_skill: 'none',
      read_skill_file: 'none',
      run_code: 'light',
      use_workspace: 'full',
    });
  });

  it('use_workspace names its last-resort cost and what to hand over', () => {
    const description = workWireTool('use_workspace').description;
    expect(description).toMatch(/last resort/);
    expect(description).toMatch(/without seeing this conversation/);
    expect(description).toMatch(/create_file and run_code/);
    const schema = schemaOf('use_workspace');
    expect(schema.required).toEqual(['reason', 'brief']);
  });

  it('recognizes its own names only', () => {
    expect(isWorkToolName('run_code')).toBe(true);
    expect(isWorkToolName('rag_search')).toBe(false);
  });

  it('steers binary formats away from create_file to run_code', () => {
    const description = workWireTool('create_file').description;
    expect(description).toMatch(/DOCX, XLSX, PPTX, PDF/);
    expect(description).toMatch(/run_code/);
  });

  it('keeps charts and documents away from the image model', () => {
    expect(workWireTool('generate_image').description).toMatch(
      /Not for charts, diagrams or documents/,
    );
  });

  it('never points a description at a tool the turn is not offered', () => {
    const neither = { createFile: false, runCode: false };
    for (const name of WORK_TOOL_NAMES.filter(
      (tool) => tool !== 'use_workspace' && tool !== 'run_code',
    )) {
      const description = workWireTool(name, neither).description;
      expect(description).not.toMatch(/run_code|create_file/);
      expect(description).not.toMatch(/[{}]/);
    }
    expect(
      workWireTool('generate_image', { createFile: true, runCode: false })
        .description,
    ).toMatch(
      /Not for charts, diagrams or documents — write an SVG with create_file\./,
    );
    expect(
      workWireTool('load_skill', { createFile: true, runCode: false })
        .description,
    ).toMatch(/scripts cannot run here/);
  });

  it('fills every slot of a description', () => {
    for (const name of WORK_TOOL_NAMES) {
      expect(workWireTool(name).description).not.toMatch(/[{}]/);
    }
  });

  it('bounds run_code by language and timeout', () => {
    const schema = schemaOf('run_code');
    const properties = schema.properties;
    if (!isRecord(properties)) throw new Error('no properties');
    const language = properties.language;
    const timeout = properties.timeoutSeconds;
    if (!isRecord(language) || !isRecord(timeout)) throw new Error('missing');
    expect(language.enum).toEqual([...RUN_CODE_LANGUAGES]);
    expect(timeout.maximum).toBe(RUN_CODE_MAX_TIMEOUT_SECONDS);
    expect(schema.required).toEqual(['language', 'code']);
  });
});
