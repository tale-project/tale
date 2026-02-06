/**
 * Shared text file type detection utility.
 * Single source of truth for determining if a file is text-based (non-binary).
 * Used by frontend (upload validation, display, preview) and backend (processing routing).
 */

export const TEXT_FILE_EXTENSIONS = new Set([
  // Plain text
  'txt', 'log', 'text',
  // Markup / docs
  'md', 'mdx', 'rst', 'tex', 'latex', 'adoc',
  // Web
  'html', 'htm', 'css', 'scss', 'sass', 'less',
  // Data / config
  'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'xml', 'csv', 'tsv', 'env', 'properties',
  // Code - JS/TS ecosystem
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts',
  // Code - Python
  'py', 'pyi', 'pyw',
  // Code - Systems
  'c', 'h', 'cpp', 'hpp', 'cc', 'cxx', 'hxx',
  'rs', 'go', 'swift', 'kt', 'kts', 'java',
  // Code - Scripting
  'rb', 'php', 'pl', 'pm', 'lua', 'r',
  'scala', 'groovy', 'dart', 'ex', 'exs',
  // Code - Shell
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  // Code - Other
  'sql', 'graphql', 'gql', 'proto', 'thrift',
  // Build / config files
  'gradle', 'cmake',
  'lock', 'gitignore', 'gitattributes', 'editorconfig',
  'eslintrc', 'prettierrc', 'babelrc',
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
  'makefile', 'dockerfile', 'gemfile', 'rakefile',
  'procfile', 'vagrantfile', 'justfile', 'taskfile',
]);

export function getFileExtensionLower(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === filename.length - 1) return '';
  return filename.slice(lastDot + 1).toLowerCase();
}

export function isTextBasedFile(filename: string, mimeType?: string): boolean {
  const ext = getFileExtensionLower(filename);
  if (ext && TEXT_FILE_EXTENSIONS.has(ext)) return true;

  if (mimeType) {
    if (TEXT_MIME_PREFIXES.some((p) => mimeType.startsWith(p))) return true;
    if (TEXT_MIME_TYPES.has(mimeType)) return true;
  }

  const base = filename.split('/').pop()?.toLowerCase() || '';
  if (KNOWN_TEXT_FILENAMES.has(base)) return true;

  return false;
}

export type TextFileCategory = 'code' | 'config' | 'markup' | 'data' | 'text';

const CODE_EXTENSIONS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts',
  'py', 'pyi', 'pyw',
  'c', 'h', 'cpp', 'hpp', 'cc', 'cxx', 'hxx',
  'rs', 'go', 'swift', 'kt', 'kts', 'java',
  'rb', 'php', 'pl', 'pm', 'lua', 'r',
  'scala', 'groovy', 'dart', 'ex', 'exs',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  'sql', 'graphql', 'gql',
]);

const CONFIG_EXTENSIONS = new Set([
  'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'xml', 'env', 'properties',
  'lock', 'gitignore', 'gitattributes', 'editorconfig',
  'eslintrc', 'prettierrc', 'babelrc',
  'gradle', 'cmake', 'proto', 'thrift',
]);

const MARKUP_EXTENSIONS = new Set([
  'html', 'htm', 'css', 'scss', 'sass', 'less',
  'md', 'mdx', 'rst', 'tex', 'latex', 'adoc',
]);

const DATA_EXTENSIONS = new Set(['csv', 'tsv']);

export function getTextFileCategory(filename: string): TextFileCategory {
  const ext = getFileExtensionLower(filename);

  if (CODE_EXTENSIONS.has(ext)) return 'code';
  if (CONFIG_EXTENSIONS.has(ext)) return 'config';
  if (MARKUP_EXTENSIONS.has(ext)) return 'markup';
  if (DATA_EXTENSIONS.has(ext)) return 'data';
  return 'text';
}
