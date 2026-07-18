import { describe, expect, it } from 'vitest';

import { CliUsageError, parseCliArgs, STAGES } from './cli';

describe('docs:videos CLI parsing', () => {
  it('defaults to ep1-welcome / en / all stages with verification on', () => {
    const options = parseCliArgs([]);
    expect(options.episodes).toEqual(['ep1-welcome']);
    expect(options.locales).toEqual(['en']);
    expect(options.stage).toBe('all');
    expect(options.verify).toBe(true);
    expect(options.mockTts).toBe(false);
    expect(options.draft).toBe(false);
  });

  it('parses comma lists and the all shorthands', () => {
    const options = parseCliArgs([
      '--episode',
      'ep2-chat,ep3-knowledge',
      '--locale',
      'de,fr',
    ]);
    expect(options.episodes).toEqual(['ep2-chat', 'ep3-knowledge']);
    expect(options.locales).toEqual(['de', 'fr']);
    expect(parseCliArgs(['--episode', 'all']).episodes).toBe('all');
    expect(parseCliArgs(['--locale', 'all']).locales).toEqual([
      'en',
      'de',
      'fr',
    ]);
  });

  it('accepts every documented stage and rejects unknown ones', () => {
    for (const stage of STAGES) {
      expect(parseCliArgs(['--stage', stage]).stage).toBe(stage);
    }
    expect(() => parseCliArgs(['--stage', 'render'])).toThrow(CliUsageError);
  });

  it('parses the mode flags', () => {
    const options = parseCliArgs(['--mock-tts', '--draft', '--no-verify']);
    expect(options.mockTts).toBe(true);
    expect(options.draft).toBe(true);
    expect(options.verify).toBe(false);
    expect(parseCliArgs(['--doctor']).doctor).toBe(true);
    expect(parseCliArgs(['-h']).help).toBe(true);
  });

  it('rejects unknown arguments, locales, and dangling values', () => {
    expect(() => parseCliArgs(['--frames'])).toThrow(CliUsageError);
    expect(() => parseCliArgs(['--locale', 'es'])).toThrow(/Unknown locale/);
    expect(() => parseCliArgs(['--episode'])).toThrow(/needs a value/);
  });
});
