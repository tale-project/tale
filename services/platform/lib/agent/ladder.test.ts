import { describe, expect, it } from 'vitest';

import { offersWork, renderWorkLadder, type WorkLoadout } from './ladder';

const ALL: WorkLoadout = {
  createFile: true,
  generateImage: true,
  skills: true,
  runCode: true,
};
const NONE: WorkLoadout = {
  createFile: false,
  generateImage: false,
  skills: false,
  runCode: false,
};

describe('renderWorkLadder', () => {
  it('says nothing when no work tool is offered', () => {
    expect(offersWork(NONE)).toBe(false);
    expect(renderWorkLadder(NONE)).toBeUndefined();
  });

  it('orders the steps from the cheapest to the costliest', () => {
    const text = renderWorkLadder(ALL) ?? '';
    const order = ['your reply', 'create_file', 'generate_image', 'run_code'];
    const positions = order.map((needle) => text.indexOf(needle));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text).toMatch(/1\. your reply/);
    expect(text).toMatch(/4\. run_code/);
  });

  it('names only the tools the turn is offered, numbered without gaps', () => {
    const text =
      renderWorkLadder({ ...NONE, createFile: true, runCode: true }) ?? '';
    expect(text).not.toMatch(/generate_image/);
    expect(text).not.toMatch(/load_skill/);
    expect(text).toMatch(/2\. create_file/);
    expect(text).toMatch(/3\. run_code/);
  });

  it('points at the skills only when they are offered', () => {
    expect(renderWorkLadder(ALL)).toMatch(/load it with load_skill/);
    expect(renderWorkLadder({ ...ALL, skills: false })).not.toMatch(
      /load_skill/,
    );
  });
});
