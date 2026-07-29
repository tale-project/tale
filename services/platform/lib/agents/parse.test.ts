import { describe, expect, it } from 'vitest';

import type { AgentDefinition } from '../shared/schemas/agents';
import { AgentParseError, parseAgentYaml, serializeAgentYaml } from './parse';

const PATH = '/config/acme/agents/assistant.yml';

function agentYaml(lines: string[]): string {
  return `${lines.join('\n')}\n`;
}

const minimal = agentYaml(['name: assistant', 'display-name: Assistant']);

function parseFails(content: string): AgentParseError {
  try {
    parseAgentYaml(content, PATH);
  } catch (err) {
    if (err instanceof AgentParseError) return err;
    throw err;
  }
  throw new Error('expected the agent file to be rejected');
}

describe('reading an agent file', () => {
  it('normalizes the file into the shape code reads', () => {
    const agent = parseAgentYaml(
      agentYaml([
        'name: assistant',
        'display-name: Assistant',
        'description: General help',
        'visibility: org',
        'icon: lucide:bot',
        'labels:',
        '  - General',
        'instructions: Be concise.',
        'tools:',
        '  - get_knowledge',
        'skills:',
        '  - pdf',
        'knowledge: documents',
        'i18n:',
        '  de:',
        '    display-name: Assistent',
        '    instructions: Sei knapp.',
      ]),
      PATH,
    );

    expect(agent).toEqual({
      name: 'assistant',
      displayName: 'Assistant',
      description: 'General help',
      visibility: 'org',
      icon: 'lucide:bot',
      labels: ['General'],
      instructions: 'Be concise.',
      tools: ['get_knowledge'],
      skills: ['pdf'],
      knowledge: 'documents',
      i18n: { de: { displayName: 'Assistent', instructions: 'Sei knapp.' } },
    });
  });

  it('defaults an unmarked agent to the whole organization and every corpus', () => {
    const agent = parseAgentYaml(minimal, PATH);
    expect(agent.visibility).toBe('org');
    // Absent means "not narrowed" for every binding — the same rule the tool
    // and skill allowlists follow.
    expect(agent.knowledge).toBe('all');
    expect(agent.tools).toBeUndefined();
    expect(agent.skills).toBeUndefined();
  });

  it('keeps an empty allowlist distinct from an absent one', () => {
    const agent = parseAgentYaml(
      agentYaml(['name: assistant', 'display-name: Assistant', 'tools: []']),
      PATH,
    );
    expect(agent.tools).toEqual([]);
    expect(agent.skills).toBeUndefined();
  });

  it('names the file in every failure', () => {
    expect(parseFails('name: [unclosed').message).toContain(PATH);
  });
});

describe('settings an agent no longer has', () => {
  // Each of these is REJECTED rather than ignored: a file that still says
  // `supported-models:` reads, to whoever wrote it, like a file that still
  // pins a model.
  const retired: Array<[string, string, string]> = [
    ['a pinned model', 'supported-models:\n  - openrouter:gpt-5.5', 'composer'],
    ['a model by any other name', 'model: openrouter:gpt-5.5', 'composer'],
    ['a timeout', 'timeout-ms: 60000', 'host'],
    ['conversation starters', 'conversation-starters:\n  - Hi', 'composer'],
    ['a behaviour kind', 'agent-kind: claude-code', 'harness'],
    ['an auth mode', 'auth-mode: byo', 'credentials'],
    ['routing', 'routing:\n  modelSelection: auto', 'behalf'],
    ['env requirements', 'env:\n  - API_KEY', 'credentials'],
  ];

  for (const [what, line, because] of retired) {
    it(`refuses ${what}, saying what replaced it`, () => {
      const error = parseFails(agentYaml([minimal.trim(), line]));
      expect(error.detail).toContain('not an agent setting any more');
      expect(error.detail).toContain(because);
      // …and where the value went when the file was converted.
      expect(error.detail).toContain('metadata.retired');
    });
  }

  it('recognizes the previous spelling of a retired setting too', () => {
    const error = parseFails(agentYaml([minimal.trim(), 'timeoutMs: 60000']));
    expect(error.detail).toContain('timeoutMs');
    expect(error.detail).toContain('not an agent setting any more');
  });

  it('refuses a key nothing ever defined', () => {
    const error = parseFails(agentYaml([minimal.trim(), 'colour: blue']));
    expect(error.detail).toContain('colour');
  });

  it('accepts a converted file, whose retired values live under metadata', () => {
    const agent = parseAgentYaml(
      agentYaml([
        minimal.trim(),
        'metadata:',
        '  retired:',
        '    supported-models:',
        '      - openrouter:anthropic/claude-opus-4.8',
        '    timeout-ms: 60000',
      ]),
      PATH,
    );
    expect(agent.metadata).toEqual({
      retired: {
        'supported-models': ['openrouter:anthropic/claude-opus-4.8'],
        'timeout-ms': 60000,
      },
    });
  });
});

describe('what a file must say to be an agent', () => {
  it('needs a name and a label', () => {
    expect(parseFails('display-name: Assistant\n').detail).toContain('name');
    expect(parseFails('name: assistant\n').detail).toContain('display-name');
  });

  it('refuses a name a file name could not carry', () => {
    for (const name of ['Assistant', 'my agent', '-leading', 'trailing-']) {
      expect(
        parseFails(agentYaml([`name: ${name}`, 'display-name: A'])).detail,
      ).toContain('name');
    }
  });

  it('accepts the underscored names agents were allowed to have', () => {
    expect(
      parseAgentYaml(
        agentYaml(['name: code_reviewer', 'display-name: Reviewer']),
        PATH,
      ).name,
    ).toBe('code_reviewer');
  });

  it('refuses a private agent nobody owns', () => {
    const error = parseFails(
      agentYaml([minimal.trim(), 'visibility: private']),
    );
    expect(error.detail).toContain('owner');
  });

  it('accepts a private agent with an owner', () => {
    const agent = parseAgentYaml(
      agentYaml([minimal.trim(), 'visibility: private', 'owner: user_alice']),
      PATH,
    );
    expect(agent.visibility).toBe('private');
    expect(agent.owner).toBe('user_alice');
  });

  it('refuses an icon that is not an Iconify id', () => {
    expect(
      parseFails(agentYaml([minimal.trim(), 'icon: https://example.com/a.png']))
        .detail,
    ).toContain('icon');
  });
});

describe('writing an agent file', () => {
  const agent: AgentDefinition = {
    name: 'assistant',
    displayName: 'Assistant',
    description: 'General help',
    visibility: 'org',
    labels: ['General'],
    instructions: 'Be concise.',
    skills: ['pdf'],
    knowledge: 'documents',
    i18n: { de: { displayName: 'Assistent' } },
    metadata: { retired: { 'timeout-ms': 60000 } },
  };

  it('round-trips: what is written reads back identically', () => {
    expect(parseAgentYaml(serializeAgentYaml(agent), PATH)).toEqual(agent);
  });

  it('writes the same bytes for the same agent', () => {
    expect(serializeAgentYaml(agent)).toBe(serializeAgentYaml({ ...agent }));
  });
});
