import { describe, it, expect } from 'vitest';

import { resolveKnowledgeFileIds } from '../resolve_knowledge_file_ids';

describe('resolveKnowledgeFileIds', () => {
  it('returns undefined when raw is undefined', () => {
    expect(resolveKnowledgeFileIds(undefined, {})).toBeUndefined();
  });

  it('passes through a literal string array unchanged', () => {
    const result = resolveKnowledgeFileIds(['file-a', 'file-b'], {});
    expect(result).toEqual(['file-a', 'file-b']);
  });

  it('resolves template elements within a literal array', () => {
    const variables = { input: { fileId: 'resolved-id' } };
    const result = resolveKnowledgeFileIds(
      ['static-file', '{{input.fileId}}'],
      variables,
    );
    expect(result).toEqual(['static-file', 'resolved-id']);
  });

  it('resolves a single template expression to an array', () => {
    const variables = { input: { files: ['file-1', 'file-2', 'file-3'] } };
    const result = resolveKnowledgeFileIds('{{input.files}}', variables);
    expect(result).toEqual(['file-1', 'file-2', 'file-3']);
  });

  it('throws when a template expression resolves to a non-array', () => {
    const variables = { input: { name: 'not-an-array' } };
    expect(() => resolveKnowledgeFileIds('{{input.name}}', variables)).toThrow(
      'knowledgeFileIds template must resolve to an array',
    );
  });

  it('throws when an array element resolves to a non-string', () => {
    const variables = { input: { num: 42 } };
    expect(() => resolveKnowledgeFileIds(['{{input.num}}'], variables)).toThrow(
      'knowledgeFileIds array element must resolve to a string',
    );
  });

  it('throws when a resolved array contains non-string elements', () => {
    const variables = { input: { mixed: ['file-1', 42] } };
    expect(() => resolveKnowledgeFileIds('{{input.mixed}}', variables)).toThrow(
      'knowledgeFileIds array element must be a string',
    );
  });

  it('returns an empty array when template resolves to empty array', () => {
    const variables = { input: { files: [] } };
    const result = resolveKnowledgeFileIds('{{input.files}}', variables);
    expect(result).toEqual([]);
  });
});
