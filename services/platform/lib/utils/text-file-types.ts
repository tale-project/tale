/**
 * Shared text file type detection utility.
 * Single source of truth for determining if a file is text-based (non-binary).
 * Used by frontend (upload validation, display, preview) and backend (processing routing).
 */

const CODE_EXTENSIONS = new Set([
  'js',
  'jsx',
  'ts',
  'tsx',
  'mjs',
  'cjs',
  'mts',
  'cts',
  'py',
  'pyi',
  'pyw',
  'c',
  'h',
  'cpp',
  'hpp',
  'cc',
  'cxx',
  'hxx',
  'rs',
  'go',
  'swift',
  'kt',
  'kts',
  'java',
  'rb',
  'php',
  'pl',
  'pm',
  'lua',
  'r',
  'scala',
  'groovy',
  'dart',
  'ex',
  'exs',
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  'bat',
  'cmd',
  'sql',
  'graphql',
  'gql',
]);

const CONFIG_EXTENSIONS = new Set([
  'json',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'xml',
  'env',
  'properties',
  'lock',
  'gitignore',
  'gitattributes',
  'editorconfig',
  'eslintrc',
  'prettierrc',
  'babelrc',
  'gradle',
  'cmake',
  'proto',
  'thrift',
]);

const MARKUP_EXTENSIONS = new Set([
  'html',
  'htm',
  'css',
  'scss',
  'sass',
  'less',
  'md',
  'mdx',
  'rst',
  'tex',
  'latex',
  'adoc',
]);

const DATA_EXTENSIONS = new Set(['csv', 'tsv']);

const TEXT_EXTENSIONS = new Set(['txt', 'log', 'text']);

const TEXT_FILE_EXTENSIONS = new Set([
  ...CODE_EXTENSIONS,
  ...CONFIG_EXTENSIONS,
  ...MARKUP_EXTENSIONS,
  ...DATA_EXTENSIONS,
  ...TEXT_EXTENSIONS,
]);

const TEXT_MIME_PREFIXES = ['text/'];

const TEXT_MIME_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/typescript',
  'application/x-yaml',
  'application/toml',
  'application/sql',
  'application/graphql',
  'application/x-sh',
  'application/x-httpd-php',
]);

const KNOWN_TEXT_FILENAMES = new Set([
  'makefile',
  'dockerfile',
  'gemfile',
  'rakefile',
  'procfile',
  'vagrantfile',
  'justfile',
  'taskfile',
]);

export const TEXT_FILE_ACCEPT = [
  'image/*',
  '.pdf',
  '.doc',
  '.docx',
  '.ppt',
  '.pptx',
  '.xls',
  '.xlsx',
  ...[...TEXT_FILE_EXTENSIONS].map((ext) => `.${ext}`),
].join(',');

export function getFileExtensionLower(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === filename.length - 1) return '';
  return filename.slice(lastDot + 1).toLowerCase();
}

function stripUrlParams(input: string): string {
  try {
    return new URL(input, 'http://local').pathname;
  } catch {
    return input.split('?')[0].split('#')[0];
  }
}

export function isTextBasedFile(filename: string, mimeType?: string): boolean {
  const cleaned = stripUrlParams(filename);
  const ext = getFileExtensionLower(cleaned);
  if (ext && TEXT_FILE_EXTENSIONS.has(ext)) return true;

  if (mimeType) {
    if (TEXT_MIME_PREFIXES.some((p) => mimeType.startsWith(p))) return true;
    if (TEXT_MIME_TYPES.has(mimeType)) return true;
  }

  const base = cleaned.split('/').pop()?.toLowerCase() || '';
  if (KNOWN_TEXT_FILENAMES.has(base)) return true;

  return false;
}

export type TextFileCategory = 'code' | 'config' | 'markup' | 'data' | 'text';

export function getTextFileCategory(filename: string): TextFileCategory {
  const ext = getFileExtensionLower(filename);

  if (CODE_EXTENSIONS.has(ext)) return 'code';
  if (CONFIG_EXTENSIONS.has(ext)) return 'config';
  if (MARKUP_EXTENSIONS.has(ext)) return 'markup';
  if (DATA_EXTENSIONS.has(ext)) return 'data';
  return 'text';
}
