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

  it('adds the full workspace as the last rung only when the turn may hand over', () => {
    expect(renderWorkLadder(ALL)).not.toMatch(/use_workspace/);
    const text = renderWorkLadder({ ...ALL, escalate: true }) ?? '';
    expect(text).toMatch(/5\. use_workspace/);
    expect(text.indexOf('run_code')).toBeLessThan(
      text.indexOf('use_workspace'),
    );
    expect(offersWork({ ...NONE, escalate: true })).toBe(true);
  });

  it('points at the skills only when they are offered', () => {
    expect(renderWorkLadder(ALL)).toMatch(/load it with load_skill/);
    expect(renderWorkLadder({ ...ALL, skills: false })).not.toMatch(
      /load_skill/,
    );
  });

  describe('pictures', () => {
    const IMAGES_OFF: WorkLoadout = { ...ALL, generateImage: false };

    it('offers generate_image for a picture while image generation is on', () => {
      const text = renderWorkLadder(ALL) ?? '';
      expect(text).toMatch(/3\. generate_image — a picture/);
      expect(text).not.toMatch(/Image generation is not available/);
      expect(text).not.toMatch(/Governance/);
    });

    it('says pictures cannot be made while image generation is off, and who turns it on', () => {
      const text = renderWorkLadder(IMAGES_OFF) ?? '';
      expect(text).not.toMatch(/generate_image/);
      expect(text).toMatch(/Image generation is not available/);
      expect(text).toMatch(/no photo, illustration or artwork/);
      expect(text).toMatch(/When asked for one, say so plainly/);
      expect(text).toMatch(/an Admin or Owner can turn it on/);
      expect(text).toContain(
        'Settings → Governance → Models → Image generation',
      );
    });

    it('keeps SVG for diagrams, icons and charts, never as a stand-in for a picture', () => {
      const text = renderWorkLadder(IMAGES_OFF) ?? '';
      expect(text).toMatch(/2\. create_file — .*SVG/);
      expect(text).toMatch(
        /Never pass off an SVG or a drawing made with code as such a picture/,
      );
      expect(text).toMatch(/those are for diagrams, icons and charts/);
    });

    it('says so after the numbered steps, before the skills and the closing rule', () => {
      const text = renderWorkLadder(IMAGES_OFF) ?? '';
      const order = [
        '3. run_code',
        'Image generation is not available',
        'load it with load_skill',
        'Never use a costlier step',
      ].map((needle) => text.indexOf(needle));
      expect(order.every((at) => at >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    it('says so whatever else the turn offers, and nothing when it offers no work tool', () => {
      expect(renderWorkLadder({ ...NONE, skills: true })).toMatch(
        /Image generation is not available/,
      );
      expect(renderWorkLadder({ ...NONE, escalate: true })).toMatch(
        /Image generation is not available/,
      );
      expect(renderWorkLadder(NONE)).toBeUndefined();
    });
  });
});
