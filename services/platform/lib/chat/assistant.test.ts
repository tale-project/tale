import { describe, expect, it } from 'vitest';

import {
  CHAT_ASSISTANT,
  CHAT_ASSISTANT_SLUG,
  chatAgentFor,
  chatAssistantFor,
  TALE_DOCS_INDEX_URL,
} from './assistant';

/**
 * The instructions are a SUBTRACTIVE contract: persona, product boundary,
 * and safety — never tool-ordering policy, which lives on the wire tool
 * descriptions (`tools.ts`). These tests pin what must stay absent and the
 * few things that must stay present, without snapshotting the prose.
 */

const instructions = CHAT_ASSISTANT.instructions ?? '';

describe('CHAT_ASSISTANT', () => {
  it('keeps the fixed slug the executors audit-log under', () => {
    expect(CHAT_ASSISTANT.slug).toBe(CHAT_ASSISTANT_SLUG);
  });

  it('carries no tool-ordering rules — that steer rides the tool descriptions', () => {
    expect(instructions).not.toMatch(/SEARCH BEFORE/i);
    expect(instructions).not.toMatch(/PRESENT TOOL RESULTS/i);
    expect(instructions).not.toMatch(/FETCH BEFORE QUOTING/i);
    // No numbered rule list at all — subtraction, not a new playbook.
    expect(instructions).not.toMatch(/^\s*\d+\.\s/m);
  });

  it('never sends an empty search to the settings pages as the next step', () => {
    expect(instructions).not.toContain('Documents page');
    expect(instructions).not.toContain('Websites page');
  });

  it('does not restate the untrusted-content rules the context injects', () => {
    expect(instructions).not.toMatch(/untrusted-content markers/i);
  });

  it('keeps persona, honesty, the Task boundary, and the format ban', () => {
    expect(instructions).toMatch(/never invent facts/i);
    expect(instructions).toContain('DELIVERABLES GO TO TASKS');
    // An image is agent work too: chat never generates one.
    expect(instructions).toMatch(/a translated document, an image, an export/);
    // What fits in a reply comes first; the file follows the person's own
    // hand-over steps, never ones the model makes up.
    expect(instructions).toMatch(/first give what fits in a reply/);
    expect(instructions).toMatch(/hand-over note below/);
    expect(instructions).toMatch(/never invent menus, projects or roles/);
    expect(instructions).toMatch(/internal formats/i);
    expect(instructions).toMatch(/cite the documents and pages/i);
  });

  it('stays a slim persona and names nothing eval-specific', () => {
    expect(instructions.length).toBeLessThan(1800);
    // Tale's own documentation is the one address the persona may name — it
    // grounds questions about the product itself, not an eval's sources.
    expect(instructions.replaceAll(TALE_DOCS_INDEX_URL, '')).not.toMatch(
      /https?:\/\//,
    );
  });

  it('answers questions about Tale from its documentation, never guessed URLs', () => {
    expect(instructions).toContain('QUESTIONS ABOUT TALE');
    expect(instructions).toContain(TALE_DOCS_INDEX_URL);
    // The public docs, never a host derived from this deployment's origin.
    expect(TALE_DOCS_INDEX_URL).toBe('https://docs.tale.dev/llms.txt');
    expect(instructions).toMatch(/never guess a docs URL/i);
    expect(instructions).toMatch(/latest release/i);
  });
});

describe('chatAssistantFor — the persona a work loadout runs as', () => {
  const NONE = {
    createFile: false,
    generateImage: false,
    skills: false,
    runCode: false,
  };
  const ALL = {
    createFile: true,
    generateImage: true,
    skills: true,
    runCode: true,
  };

  it('is the tool-less persona byte for byte when no work tool is offered', () => {
    expect(chatAssistantFor(NONE)).toBe(CHAT_ASSISTANT);
  });

  it('makes files in the chat instead of sending them to a task', () => {
    const text = chatAssistantFor(ALL).instructions ?? '';
    expect(text).not.toMatch(/DELIVERABLES GO TO TASKS/);
    expect(text).toMatch(/MAKING THINGS/);
    expect(text).toMatch(/TASK WORK/);
    expect(text).toMatch(/make the files the person asks for/);
  });

  it('keeps the persona, the safety rules and the docs pointer', () => {
    const text = chatAssistantFor(ALL).instructions ?? '';
    expect(chatAssistantFor(ALL).slug).toBe(CHAT_ASSISTANT_SLUG);
    expect(text).toMatch(/NO FABRICATION/);
    expect(text).toMatch(/NO RAW CONTEXT OUTPUT/);
    expect(text).toContain(TALE_DOCS_INDEX_URL);
  });

  it('is one text per loadout, so the cached prefix moves only with policy', () => {
    expect(chatAssistantFor(ALL).instructions).toBe(
      chatAssistantFor({ ...ALL }).instructions,
    );
    expect(chatAssistantFor(ALL).instructions).not.toBe(
      chatAssistantFor({ ...ALL, runCode: false }).instructions,
    );
  });

  it('tells the assistant that pictures cannot be made while image generation is off, and who turns it on [CHAT-R32]', () => {
    // The organization's defaults: every chat tool on, image generation off.
    const text =
      chatAssistantFor({ ...ALL, generateImage: false }).instructions ?? '';
    expect(text).toMatch(/MAKING THINGS/);
    expect(text).not.toMatch(/generate_image/);
    expect(text).toMatch(/Image generation is not available/);
    expect(text).toMatch(/an Admin or Owner can turn it on/);
    expect(text).toContain('Settings → Governance → Models → Image generation');
    expect(text).toMatch(/Never pass off an SVG/);
    // With image generation on, it has the image tool and is told nothing of it.
    const on = chatAssistantFor(ALL).instructions ?? '';
    expect(on).toMatch(/generate_image/);
    expect(on).not.toMatch(/Image generation is not available/);
  });

  it('is the tool-less persona when the host offers no work tool at all', () => {
    expect(chatAssistantFor(undefined)).toBe(CHAT_ASSISTANT);
  });

  describe('when the file tools could not be set up for the reply', () => {
    it('says files cannot be made in this reply, never that chat makes none', () => {
      const text =
        chatAssistantFor(undefined, { toolsUnavailable: true }).instructions ??
        '';
      expect(text).toMatch(/FILE TOOLS UNAVAILABLE/);
      expect(text).toMatch(/files cannot be made in this reply/);
      expect(text).not.toMatch(/DELIVERABLES GO TO TASKS/);
      expect(text).not.toMatch(/MAKING THINGS/);
    });

    it('keeps the ladder of what it still offers', () => {
      const text =
        chatAssistantFor(
          { ...NONE, generateImage: true },
          { toolsUnavailable: true },
        ).instructions ?? '';
      expect(text).toMatch(/generate_image/);
      expect(text).toMatch(/FILE TOOLS UNAVAILABLE/);
      expect(text).not.toMatch(/TASK WORK/);
    });
  });
});

describe('chatAgentFor — a project agent answering a chat [CHAT-R41]', () => {
  const AGENT = {
    id: 'agent_7',
    name: 'Copy reviewer',
    instructions: 'Review copy for tone and British spelling.',
    skills: ['docx'],
  };
  const ALL = {
    createFile: true,
    generateImage: true,
    skills: true,
    runCode: true,
  };
  const NONE = {
    createFile: false,
    generateImage: false,
    skills: false,
    runCode: false,
  };

  it("leads with the agent's own instructions and speaks under its id", () => {
    const persona = chatAgentFor(AGENT, ALL);
    expect(persona.slug).toBe('agent_7');
    expect(persona.instructions.startsWith(AGENT.instructions)).toBe(true);
    expect(persona.instructions).toMatch(/"Copy reviewer"/);
  });

  it('says what of the agent a chat lacks, and where that work goes', () => {
    const text = chatAgentFor(AGENT, ALL).instructions;
    expect(text).toMatch(/IN THIS CHAT/);
    expect(text).toMatch(
      /runtime, repository access, connectors, platform tools and secrets are not available/,
    );
    expect(text).toMatch(/hand-over note/);
    expect(text).not.toMatch(/THIS RUN/);
  });

  it('keeps every rule a chat reply keeps, with the ladder for the tools offered', () => {
    const text = chatAgentFor(AGENT, ALL).instructions;
    for (const rule of [
      /NO FABRICATION/,
      /THE WORK LIVES HERE/,
      /MAKING THINGS/,
      /TASK WORK/,
      /QUESTIONS ABOUT TALE/,
      /NO RAW CONTEXT OUTPUT/,
      /RESPONSE STYLE/,
    ]) {
      expect(text).toMatch(rule);
    }
    expect(chatAgentFor(AGENT, NONE).instructions).toMatch(
      /DELIVERABLES GO TO TASKS/,
    );
    const unavailable = chatAgentFor(AGENT, undefined, {
      toolsUnavailable: true,
    }).instructions;
    expect(unavailable).toMatch(/FILE TOOLS UNAVAILABLE/);
    expect(unavailable).not.toMatch(/DELIVERABLES GO TO TASKS/);
  });

  it('opens with the chat note when the agent has no instructions of its own', () => {
    const text = chatAgentFor(
      { ...AGENT, instructions: '  ' },
      ALL,
    ).instructions;
    expect(text.startsWith('**IN THIS CHAT**')).toBe(true);
  });
});
