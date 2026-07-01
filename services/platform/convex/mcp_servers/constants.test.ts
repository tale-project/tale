import { describe, expect, it } from 'vitest';

import {
  MCP_SERVER_NAME_MAX_LENGTH,
  MCP_SERVER_NAME_RE,
  validateMcpServerName,
} from './constants';

describe('validateMcpServerName', () => {
  it('accepts lowercase alphanumeric slugs with hyphens', () => {
    expect(validateMcpServerName('my-mcp-server')).toBeNull();
    expect(validateMcpServerName('server1')).toBeNull();
    expect(validateMcpServerName('a-b-c')).toBeNull();
  });

  it('accepts a single valid character (no length carve-out)', () => {
    expect(validateMcpServerName('a')).toBeNull();
    expect(validateMcpServerName('1')).toBeNull();
  });

  it('rejects a single uppercase character', () => {
    // The old client guard skipped validation for length-1 names, so "A"
    // slipped through; it must now be rejected.
    expect(validateMcpServerName('A')).toBe('invalid_format');
  });

  it('trims before validating and rejects an empty/whitespace name', () => {
    expect(validateMcpServerName('')).toBe('required');
    expect(validateMcpServerName('   ')).toBe('required');
    expect(validateMcpServerName('  good-name  ')).toBeNull();
  });

  it('rejects uppercase, leading/trailing hyphens, and illegal symbols', () => {
    expect(validateMcpServerName('My-Server')).toBe('invalid_format');
    expect(validateMcpServerName('-leading')).toBe('invalid_format');
    expect(validateMcpServerName('trailing-')).toBe('invalid_format');
    expect(validateMcpServerName('has space')).toBe('invalid_format');
    expect(validateMcpServerName('under_score')).toBe('invalid_format');
  });

  it('rejects names longer than the max length', () => {
    expect(
      validateMcpServerName('a'.repeat(MCP_SERVER_NAME_MAX_LENGTH + 1)),
    ).toBe('too_long');
    expect(
      validateMcpServerName('a'.repeat(MCP_SERVER_NAME_MAX_LENGTH)),
    ).toBeNull();
  });

  it('exposes a regex consistent with the validator', () => {
    expect(MCP_SERVER_NAME_RE.test('valid-name')).toBe(true);
    expect(MCP_SERVER_NAME_RE.test('Invalid')).toBe(false);
  });
});
