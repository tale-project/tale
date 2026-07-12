import { describe, expect, it } from 'vitest';

import type { InputSchema } from '../../utils/input-schema-template';
import {
  assembleScheduleVariables,
  buildScheduleConfigFields,
  seedScheduleFieldValues,
  SCHEDULE_REPO_FIELD_KEY,
} from './schedule-config-fields';

const COPY = {
  projectLabel: 'Project',
  projectPlaceholder: 'Select a project',
  repoLabel: 'GitHub repository',
  repoPlaceholder: 'owner/repo or a GitHub URL',
};

const PROJECT_OPTIONS = [{ value: 'proj_1', label: 'Acme' }];

/** `buildScheduleConfigFields` returns `null` only for a schema the caller
 *  can't render as plain controls — every fixture below is renderable, so a
 *  `null` result is itself a test failure. Centralizes the non-null
 *  assertion so it's proven once instead of five bare `!` assertions. */
function nonNullFields(
  fields: ReturnType<typeof buildScheduleConfigFields>,
): NonNullable<ReturnType<typeof buildScheduleConfigFields>> {
  expect(fields).not.toBeNull();
  // oxlint-disable-next-line typescript/no-non-null-assertion -- asserted above
  return fields!;
}

describe('buildScheduleConfigFields', () => {
  it('returns [] for a schema with no properties', () => {
    expect(buildScheduleConfigFields(undefined, [], COPY)).toEqual([]);
    expect(buildScheduleConfigFields({ properties: {} }, [], COPY)).toEqual([]);
  });

  it('maps plain scalar properties, carrying required + description', () => {
    const schema: InputSchema = {
      properties: {
        limit: { type: 'number', description: 'Max items per run' },
        enabled: { type: 'boolean' },
      },
      required: ['limit'],
    };

    expect(buildScheduleConfigFields(schema, [], COPY)).toEqual([
      {
        key: 'limit',
        type: 'number',
        help: 'Max items per run',
        required: true,
      },
      { key: 'enabled', type: 'boolean', help: undefined, required: false },
    ]);
  });

  it('maps an "integer" schema type to the "number" field type', () => {
    const schema: InputSchema = {
      properties: { count: { type: 'integer' } },
      required: ['count'],
    };
    const fields = buildScheduleConfigFields(schema, [], COPY);
    expect(fields).toEqual([
      { key: 'count', type: 'number', help: undefined, required: true },
    ]);
  });

  it('returns null when a property is an array or object — the caller falls back to JSON', () => {
    expect(
      buildScheduleConfigFields(
        { properties: { tags: { type: 'array' } }, required: [] },
        [],
        COPY,
      ),
    ).toBeNull();
    expect(
      buildScheduleConfigFields(
        { properties: { meta: { type: 'object' } }, required: [] },
        [],
        COPY,
      ),
    ).toBeNull();
  });

  it('turns `projectId` into a select field with the caller-supplied project options', () => {
    const schema: InputSchema = {
      properties: {
        projectId: { type: 'string', description: 'Target project' },
      },
      required: ['projectId'],
    };
    expect(buildScheduleConfigFields(schema, PROJECT_OPTIONS, COPY)).toEqual([
      {
        key: 'projectId',
        type: 'select',
        label: 'Project',
        placeholder: 'Select a project',
        help: 'Target project',
        required: true,
        options: PROJECT_OPTIONS,
      },
    ]);
  });

  it('collapses owner + repo into ONE derived field, in the position of the first key', () => {
    const schema: InputSchema = {
      properties: {
        title: { type: 'string' },
        owner: { type: 'string', description: 'Repo owner' },
        repo: { type: 'string' },
      },
      required: ['owner', 'repo'],
    };
    const fields = buildScheduleConfigFields(schema, [], COPY);
    expect(fields).toEqual([
      { key: 'title', type: 'string', help: undefined, required: false },
      {
        key: SCHEDULE_REPO_FIELD_KEY,
        type: 'string',
        label: 'GitHub repository',
        placeholder: 'owner/repo or a GitHub URL',
        help: 'Repo owner',
        required: true,
        derive: {
          pattern: expect.any(String) as unknown as string,
          into: ['owner', 'repo'],
        },
      },
    ]);
  });

  it('leaves owner/repo as plain fields when only one of the pair is declared', () => {
    const schema: InputSchema = {
      properties: { owner: { type: 'string' } },
      required: [],
    };
    expect(buildScheduleConfigFields(schema, [], COPY)).toEqual([
      { key: 'owner', type: 'string', help: undefined, required: false },
    ]);
  });
});

describe('seedScheduleFieldValues', () => {
  it('defaults projectId to the schedule row binding when variables carry none', () => {
    const fields = nonNullFields(
      buildScheduleConfigFields(
        {
          properties: { projectId: { type: 'string' } },
          required: ['projectId'],
        },
        PROJECT_OPTIONS,
        COPY,
      ),
    );
    expect(seedScheduleFieldValues(fields, {}, 'proj_1')).toEqual({
      projectId: 'proj_1',
    });
    expect(
      seedScheduleFieldValues(fields, { projectId: '' }, 'proj_1'),
    ).toEqual({ projectId: 'proj_1' });
  });

  it('never overrides an operator-set projectId already in the variables', () => {
    const fields = nonNullFields(
      buildScheduleConfigFields(
        {
          properties: { projectId: { type: 'string' } },
          required: ['projectId'],
        },
        PROJECT_OPTIONS,
        COPY,
      ),
    );
    expect(
      seedScheduleFieldValues(fields, { projectId: 'proj_2' }, 'proj_1'),
    ).toEqual({ projectId: 'proj_2' });
  });

  it('reconstructs the combined repo field raw text from existing owner/repo', () => {
    const fields = nonNullFields(
      buildScheduleConfigFields(
        {
          properties: { owner: { type: 'string' }, repo: { type: 'string' } },
          required: [],
        },
        [],
        COPY,
      ),
    );
    expect(
      seedScheduleFieldValues(
        fields,
        { owner: 'acme', repo: 'widgets' },
        undefined,
      ),
    ).toEqual({
      owner: 'acme',
      repo: 'widgets',
      [SCHEDULE_REPO_FIELD_KEY]: 'acme/widgets',
    });
  });

  it('leaves the repo field unseeded when only one of owner/repo is set', () => {
    const fields = nonNullFields(
      buildScheduleConfigFields(
        {
          properties: { owner: { type: 'string' }, repo: { type: 'string' } },
          required: [],
        },
        [],
        COPY,
      ),
    );
    expect(
      seedScheduleFieldValues(fields, { owner: 'acme' }, undefined),
    ).toEqual({ owner: 'acme' });
  });
});

describe('assembleScheduleVariables', () => {
  it('splits the combined repo field into owner/repo and drops the synthetic key', () => {
    const fields = nonNullFields(
      buildScheduleConfigFields(
        {
          properties: { owner: { type: 'string' }, repo: { type: 'string' } },
          required: [],
        },
        [],
        COPY,
      ),
    );
    const { variables, invalidFields } = assembleScheduleVariables(fields, {
      [SCHEDULE_REPO_FIELD_KEY]: 'acme/widgets',
    });
    expect(invalidFields).toEqual([]);
    expect(variables).toEqual({ owner: 'acme', repo: 'widgets' });
  });

  it('reports the combined field as invalid when the entered text does not derive', () => {
    const fields = nonNullFields(
      buildScheduleConfigFields(
        {
          properties: { owner: { type: 'string' }, repo: { type: 'string' } },
          required: [],
        },
        [],
        COPY,
      ),
    );
    const { invalidFields } = assembleScheduleVariables(fields, {
      [SCHEDULE_REPO_FIELD_KEY]: 'not a repo slug',
    });
    expect(invalidFields).toEqual([SCHEDULE_REPO_FIELD_KEY]);
  });

  it('passes plain scalar fields through untouched', () => {
    const fields = nonNullFields(
      buildScheduleConfigFields(
        {
          properties: {
            limit: { type: 'number' },
            enabled: { type: 'boolean' },
          },
          required: [],
        },
        [],
        COPY,
      ),
    );
    const { variables } = assembleScheduleVariables(fields, {
      limit: '5',
      enabled: true,
    });
    expect(variables).toEqual({ limit: 5, enabled: true });
  });
});
