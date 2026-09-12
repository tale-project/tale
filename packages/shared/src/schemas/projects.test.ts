import { describe, it, expect } from 'vitest';

import {
  PROJECT_NAME_MAX,
  PROJECT_INSTRUCTIONS_MAX_CHARS,
  PROJECT_DESCRIPTION_MAX,
  PROJECT_SHARED_TEAMS_MAX,
  PROJECT_RECOMMENDED_AGENTS_MAX,
  createProjectInputSchema,
  deleteProjectInputSchema,
  projectColorSchema,
  projectIconSchema,
  projectKnowledgeModeSchema,
  projectModeSchema,
  updateProjectAgentSettingsSchema,
  updateProjectIdentitySchema,
  updateProjectInstructionsSchema,
  updateProjectModelSettingsSchema,
  updateProjectSharingSchema,
} from './projects';

describe('projectColorSchema', () => {
  it('accepts a valid token', () => {
    expect(projectColorSchema.parse('emerald')).toBe('emerald');
  });

  it('rejects hex strings (we use tokens on the wire)', () => {
    expect(() => projectColorSchema.parse('#10b981')).toThrow();
  });

  it('rejects unknown tokens', () => {
    expect(() => projectColorSchema.parse('mauve')).toThrow();
  });
});

describe('projectIconSchema', () => {
  it('accepts the default icon', () => {
    expect(projectIconSchema.parse('FolderKanban')).toBe('FolderKanban');
  });

  it('rejects arbitrary icon names', () => {
    expect(() => projectIconSchema.parse('SkullAndCrossbones')).toThrow();
  });
});

describe('projectModeSchema', () => {
  it('accepts all three modes', () => {
    expect(projectModeSchema.parse('all')).toBe('all');
    expect(projectModeSchema.parse('recommended')).toBe('recommended');
    expect(projectModeSchema.parse('restricted')).toBe('restricted');
  });
});

describe('projectKnowledgeModeSchema', () => {
  it('accepts the four agent-style modes', () => {
    expect(projectKnowledgeModeSchema.parse('off')).toBe('off');
    expect(projectKnowledgeModeSchema.parse('tool')).toBe('tool');
    expect(projectKnowledgeModeSchema.parse('context')).toBe('context');
    expect(projectKnowledgeModeSchema.parse('both')).toBe('both');
  });
});

describe('createProjectInputSchema', () => {
  it('accepts minimal input', () => {
    const parsed = createProjectInputSchema.parse({
      organizationId: 'org_1',
      name: 'Q2 Sales',
    });
    expect(parsed.name).toBe('Q2 Sales');
  });

  it('trims whitespace from name', () => {
    const parsed = createProjectInputSchema.parse({
      organizationId: 'org_1',
      name: '  Hello  ',
    });
    expect(parsed.name).toBe('Hello');
  });

  it('rejects empty name', () => {
    expect(() =>
      createProjectInputSchema.parse({
        organizationId: 'org_1',
        name: '   ',
      }),
    ).toThrow();
  });

  it(`rejects name longer than ${PROJECT_NAME_MAX} chars`, () => {
    expect(() =>
      createProjectInputSchema.parse({
        organizationId: 'org_1',
        name: 'x'.repeat(PROJECT_NAME_MAX + 1),
      }),
    ).toThrow();
  });

  it(`rejects description longer than ${PROJECT_DESCRIPTION_MAX} chars`, () => {
    expect(() =>
      createProjectInputSchema.parse({
        organizationId: 'org_1',
        name: 'P',
        description: 'x'.repeat(PROJECT_DESCRIPTION_MAX + 1),
      }),
    ).toThrow();
  });

  it(`rejects more than ${PROJECT_SHARED_TEAMS_MAX} shared teams`, () => {
    expect(() =>
      createProjectInputSchema.parse({
        organizationId: 'org_1',
        name: 'P',
        sharedWithTeamIds: Array(PROJECT_SHARED_TEAMS_MAX + 1).fill('team-x'),
      }),
    ).toThrow();
  });

  it('rejects bad icon and color', () => {
    expect(() =>
      createProjectInputSchema.parse({
        organizationId: 'org_1',
        name: 'P',
        icon: 'NotAnIcon',
      }),
    ).toThrow();

    expect(() =>
      createProjectInputSchema.parse({
        organizationId: 'org_1',
        name: 'P',
        color: 'maroon',
      }),
    ).toThrow();
  });
});

describe('updateProjectIdentitySchema', () => {
  it('accepts partial updates', () => {
    expect(updateProjectIdentitySchema.parse({ name: 'New' })).toEqual({
      name: 'New',
    });
    expect(updateProjectIdentitySchema.parse({})).toEqual({});
  });

  it('accepts nullable icon and color (clear the field)', () => {
    expect(
      updateProjectIdentitySchema.parse({ icon: null, color: null }),
    ).toEqual({
      icon: null,
      color: null,
    });
  });

  it('accepts a null description (clear the field) — the service contract', () => {
    expect(updateProjectIdentitySchema.parse({ description: null })).toEqual({
      description: null,
    });
  });
});

describe('deleteProjectInputSchema', () => {
  it('requires the confirm phrase for a cascade', () => {
    expect(() => deleteProjectInputSchema.parse({ mode: 'cascade' })).toThrow();
    expect(deleteProjectInputSchema.parse({ mode: 'detach' })).toEqual({
      mode: 'detach',
    });
  });

  it('bounds the phrase at the name cap after trimming (a longer one can never match a name)', () => {
    expect(
      deleteProjectInputSchema.parse({
        mode: 'cascade',
        confirmPhrase: `  ${'x'.repeat(PROJECT_NAME_MAX)}  `,
      }).confirmPhrase,
    ).toBe('x'.repeat(PROJECT_NAME_MAX));
    expect(() =>
      deleteProjectInputSchema.parse({
        mode: 'cascade',
        confirmPhrase: 'x'.repeat(PROJECT_NAME_MAX + 1),
      }),
    ).toThrow();
  });
});

describe('updateProjectInstructionsSchema', () => {
  it('accepts empty string (clearing instructions)', () => {
    expect(updateProjectInstructionsSchema.parse({ instructions: '' })).toEqual(
      { instructions: '' },
    );
  });

  it(`rejects instructions over ${PROJECT_INSTRUCTIONS_MAX_CHARS} chars`, () => {
    expect(() =>
      updateProjectInstructionsSchema.parse({
        instructions: 'a'.repeat(PROJECT_INSTRUCTIONS_MAX_CHARS + 1),
      }),
    ).toThrow();
  });

  it(`accepts exactly ${PROJECT_INSTRUCTIONS_MAX_CHARS} chars`, () => {
    expect(() =>
      updateProjectInstructionsSchema.parse({
        instructions: 'a'.repeat(PROJECT_INSTRUCTIONS_MAX_CHARS),
      }),
    ).not.toThrow();
  });
});

describe('updateProjectSharingSchema', () => {
  it('accepts clearing teamId via null', () => {
    expect(updateProjectSharingSchema.parse({ teamId: null })).toEqual({
      teamId: null,
    });
  });

  it('accepts empty sharedWithTeamIds (org-wide)', () => {
    expect(updateProjectSharingSchema.parse({ sharedWithTeamIds: [] })).toEqual(
      { sharedWithTeamIds: [] },
    );
  });
});

describe('updateProjectAgentSettingsSchema', () => {
  it('accepts mode-only update', () => {
    expect(
      updateProjectAgentSettingsSchema.parse({ agentMode: 'all' }),
    ).toEqual({ agentMode: 'all' });
  });

  it('accepts recommended list under cap', () => {
    expect(
      updateProjectAgentSettingsSchema.parse({
        agentMode: 'recommended',
        recommendedAgentSlugs: ['recruiter-agent', 'email-outreach-helper'],
      }),
    ).toBeTruthy();
  });

  it('rejects recommended list over cap', () => {
    expect(() =>
      updateProjectAgentSettingsSchema.parse({
        agentMode: 'recommended',
        recommendedAgentSlugs: Array(PROJECT_RECOMMENDED_AGENTS_MAX + 1).fill(
          'slug',
        ),
      }),
    ).toThrow();
  });

  it('rejects invalid agent slug format', () => {
    expect(() =>
      updateProjectAgentSettingsSchema.parse({
        agentMode: 'restricted',
        allowedAgentSlugs: ['Bad Slug With Spaces'],
      }),
    ).toThrow();
  });
});

describe('updateProjectModelSettingsSchema', () => {
  it('accepts a fully-qualified model ref', () => {
    expect(
      updateProjectModelSettingsSchema.parse({
        modelMode: 'restricted',
        allowedModels: ['anthropic:claude-opus-4-7'],
      }),
    ).toBeTruthy();
  });

  it('rejects empty model ref', () => {
    expect(() =>
      updateProjectModelSettingsSchema.parse({
        modelMode: 'restricted',
        allowedModels: [''],
      }),
    ).toThrow();
  });
});

describe('deleteProjectInputSchema', () => {
  it('accepts detach without phrase', () => {
    expect(deleteProjectInputSchema.parse({ mode: 'detach' })).toEqual({
      mode: 'detach',
    });
  });

  it('accepts cascade with phrase', () => {
    expect(
      deleteProjectInputSchema.parse({
        mode: 'cascade',
        confirmPhrase: 'Q2 Sales Hiring',
      }),
    ).toBeTruthy();
  });

  it('rejects unknown mode', () => {
    expect(() => deleteProjectInputSchema.parse({ mode: 'nuke' })).toThrow();
  });
});
