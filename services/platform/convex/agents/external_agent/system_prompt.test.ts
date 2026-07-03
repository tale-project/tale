import { describe, expect, it } from 'vitest';

import { SKILLS_GUIDANCE_HEADING } from '../../lib/skills/guidance';
import { UNTRUSTED_CONTENT_SYSTEM_PROMPT } from '../../lib/untrusted_content';
import {
  ASK_IN_CHAT_ADDENDUM,
  AUTONOMOUS_MODE_ADDENDUM,
  AUTONOMOUS_PLAN_ADDENDUM,
  BROWSER_VIEW_RECOVERY_ADDENDUM,
  buildSystemPromptAppend,
  PLAN_MODE_ADDENDUM,
  STEERING_RESPONSIVENESS_ADDENDUM,
} from './system_prompt';

describe('buildSystemPromptAppend', () => {
  it('act turns get the steering-responsiveness addendum, not the plan addendum', () => {
    const out = buildSystemPromptAppend({
      systemInstructions: 'AGENT RULES',
      permissionMode: 'execute',
    });
    expect(out).toContain(STEERING_RESPONSIVENESS_ADDENDUM);
    expect(out).toContain('run_in_background');
    expect(out).not.toContain(PLAN_MODE_ADDENDUM);
    // Composed with the agent's own instructions, first and never clobbered.
    expect(out.startsWith('AGENT RULES')).toBe(true);
  });

  it('plan turns get the plan addendum, not the steering addendum', () => {
    const out = buildSystemPromptAppend({
      systemInstructions: 'AGENT RULES',
      permissionMode: 'plan',
    });
    expect(out).toContain(PLAN_MODE_ADDENDUM);
    expect(out).not.toContain(STEERING_RESPONSIVENESS_ADDENDUM);
  });

  it('drops missing instructions without a leading blank line', () => {
    const out = buildSystemPromptAppend({ permissionMode: 'execute' });
    expect(out.startsWith(STEERING_RESPONSIVENESS_ADDENDUM)).toBe(true);
  });

  it('an undefined permissionMode is treated as an act turn', () => {
    const out = buildSystemPromptAppend({ systemInstructions: 'X' });
    expect(out).toContain(STEERING_RESPONSIVENESS_ADDENDUM);
    expect(out).not.toContain(PLAN_MODE_ADDENDUM);
  });

  it('appends the browser-recovery addendum only when browserCdp is set', () => {
    const withBrowser = buildSystemPromptAppend({
      systemInstructions: 'X',
      permissionMode: 'execute',
      browserCdp: true,
    });
    expect(withBrowser).toContain(BROWSER_VIEW_RECOVERY_ADDENDUM);

    const withoutBrowser = buildSystemPromptAppend({
      systemInstructions: 'X',
      permissionMode: 'execute',
    });
    expect(withoutBrowser).not.toContain(BROWSER_VIEW_RECOVERY_ADDENDUM);
  });

  it('the browser addendum rides on plan turns too when browserCdp is set', () => {
    const out = buildSystemPromptAppend({
      systemInstructions: 'X',
      permissionMode: 'plan',
      browserCdp: true,
    });
    expect(out).toContain(PLAN_MODE_ADDENDUM);
    expect(out).toContain(BROWSER_VIEW_RECOVERY_ADDENDUM);
  });

  // --- interaction mode ---

  it('interactive turns (default) get the ask-in-chat addendum', () => {
    const out = buildSystemPromptAppend({
      systemInstructions: 'X',
      permissionMode: 'execute',
    });
    expect(out).toContain(ASK_IN_CHAT_ADDENDUM);
    expect(out).toContain(STEERING_RESPONSIVENESS_ADDENDUM);
    expect(out).not.toContain(AUTONOMOUS_MODE_ADDENDUM);
  });

  it('an explicit interactive interactionMode matches the default', () => {
    const out = buildSystemPromptAppend({
      systemInstructions: 'X',
      permissionMode: 'execute',
      interactionMode: 'interactive',
    });
    expect(out).toContain(ASK_IN_CHAT_ADDENDUM);
    expect(out).toContain(STEERING_RESPONSIVENESS_ADDENDUM);
  });

  it('autonomous execute turns swap in the autonomous addendum and never ask', () => {
    const out = buildSystemPromptAppend({
      systemInstructions: 'X',
      permissionMode: 'execute',
      interactionMode: 'autonomous',
    });
    expect(out).toContain(AUTONOMOUS_MODE_ADDENDUM);
    expect(out).not.toContain(STEERING_RESPONSIVENESS_ADDENDUM);
    expect(out).not.toContain(ASK_IN_CHAT_ADDENDUM);
    expect(out).not.toContain(PLAN_MODE_ADDENDUM);
  });

  it('autonomous plan turns use the trimmed plan addendum (no chat-UI approval promise)', () => {
    const out = buildSystemPromptAppend({
      systemInstructions: 'X',
      permissionMode: 'plan',
      interactionMode: 'autonomous',
    });
    expect(out).toContain(AUTONOMOUS_PLAN_ADDENDUM);
    expect(out).not.toContain(PLAN_MODE_ADDENDUM);
    expect(out).not.toContain(AUTONOMOUS_MODE_ADDENDUM);
    expect(out).not.toContain(ASK_IN_CHAT_ADDENDUM);
    // The interactive plan addendum promises chat-UI approval; the autonomous
    // one must not.
    expect(out).not.toContain('chat UI');
  });

  // --- skills guidance ---

  const GUIDANCE = `${SKILLS_GUIDANCE_HEADING}\n\n1. steps here`;

  it('inserts the skills guidance after the instructions, before the posture addendum', () => {
    const out = buildSystemPromptAppend({
      systemInstructions: 'AGENT RULES',
      permissionMode: 'execute',
      skillsGuidance: GUIDANCE,
    });
    const at = out.indexOf(SKILLS_GUIDANCE_HEADING);
    expect(at).toBeGreaterThan(out.indexOf('AGENT RULES'));
    expect(at).toBeLessThan(out.indexOf(STEERING_RESPONSIVENESS_ADDENDUM));
    // The untrusted-content rules must stay last.
    expect(out.endsWith(UNTRUSTED_CONTENT_SYSTEM_PROMPT)).toBe(true);
  });

  it('drops an absent or empty skills guidance without a stray blank line', () => {
    const absent = buildSystemPromptAppend({
      systemInstructions: 'X',
      permissionMode: 'execute',
    });
    const empty = buildSystemPromptAppend({
      systemInstructions: 'X',
      permissionMode: 'execute',
      skillsGuidance: '',
    });
    expect(absent).toBe(empty);
    expect(absent).not.toContain(SKILLS_GUIDANCE_HEADING);
  });

  it('drops the generated guidance when the instructions already carry the section', () => {
    const out = buildSystemPromptAppend({
      systemInstructions: `MY RULES\n\n${SKILLS_GUIDANCE_HEADING}\n\ncustom steps`,
      permissionMode: 'execute',
      skillsGuidance: GUIDANCE,
    });
    // The agent's own copy survives; the generated one is not appended twice.
    expect(out.match(new RegExp(SKILLS_GUIDANCE_HEADING, 'g'))).toHaveLength(1);
    expect(out).not.toContain('1. steps here');
  });
});
