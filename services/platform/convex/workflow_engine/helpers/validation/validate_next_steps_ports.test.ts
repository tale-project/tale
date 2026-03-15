import { describe, it, expect } from 'vitest';

import { validateNextStepsPorts } from './validate_next_steps_ports';

describe('validateNextStepsPorts', () => {
  it('passes with valid "success" port for start step', () => {
    const result = validateNextStepsPorts('start', { success: 'next_step' });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('passes with valid "success" port for llm step', () => {
    const result = validateNextStepsPorts('llm', { success: 'output_step' });
    expect(result.valid).toBe(true);
  });

  it('passes with valid "success" port for action step', () => {
    const result = validateNextStepsPorts('action', {
      success: 'next_step',
    });
    expect(result.valid).toBe(true);
  });

  it('passes with valid "true"/"false" ports for condition step', () => {
    const result = validateNextStepsPorts('condition', {
      true: 'if_true',
      false: 'if_false',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('passes with valid "loop"/"done" ports for loop step', () => {
    const result = validateNextStepsPorts('loop', {
      loop: 'loop_body',
      done: 'after_loop',
    });
    expect(result.valid).toBe(true);
  });

  it('passes with empty nextSteps for output step', () => {
    const result = validateNextStepsPorts('output', {});
    expect(result.valid).toBe(true);
  });

  it('fails with "next" port on start step', () => {
    const result = validateNextStepsPorts('start', { next: 'greet' });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid nextSteps port "next"');
    expect(result.errors[0]).toContain('success');
  });

  it('fails with "default" port on start step', () => {
    const result = validateNextStepsPorts('start', { default: 'greet' });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid nextSteps port "default"');
  });

  it('fails with "success" port on condition step', () => {
    const result = validateNextStepsPorts('condition', {
      success: 'next_step',
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid nextSteps port "success"');
    expect(result.errors[0]).toContain('true, false');
  });

  it('fails with non-empty nextSteps on output step', () => {
    const result = validateNextStepsPorts('output', {
      success: 'another_step',
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain(
      'Output steps must have empty nextSteps',
    );
  });

  it('passes for unknown step types', () => {
    const result = validateNextStepsPorts('unknown_type', {
      anything: 'step',
    });
    expect(result.valid).toBe(true);
  });

  it('fails with "next" port on llm step', () => {
    const result = validateNextStepsPorts('llm', { next: 'finish' });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid nextSteps port "next"');
  });
});
