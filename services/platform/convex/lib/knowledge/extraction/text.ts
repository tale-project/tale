'use node';

/**
 * Plain text, markdown, and CSV extraction.
 *
 * Simple UTF-8 text reading — no Vision API needed.
 */

export const SUPPORTED_TEXT_EXTENSIONS = new Set<string>([
  // Text / markup
  '.txt',
  '.md',
  '.mdx',
  '.rst',
  '.tex',
  '.csv',
  '.tsv',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.log',
  // Data / config
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.ini',
  '.cfg',
  '.conf',
  '.properties',
  // Code
  '.py',
  '.pyi',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cc',
  '.cxx',
  '.rs',
  '.go',
  '.swift',
  '.kt',
  '.java',
  '.rb',
  '.php',
  '.pl',
  '.lua',
  '.r',
  '.scala',
  '.groovy',
  '.dart',
  '.ex',
  '.exs',
  // Shell / scripts
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.bat',
  '.cmd',
  // Query / schema
  '.sql',
  '.graphql',
  '.gql',
  '.proto',
  // Build / project
  '.gradle',
  '.cmake',
  '.lock',
]);

/**
 * Extract text from plain text bytes. Decodes as UTF-8, falling back to
 * Latin-1 on invalid sequences. Returns `[text, visionUsed]`; vision is never
 * used here.
 */
export async function extractTextFromTextBytes(
  textBytes: Uint8Array,
  filename = 'document.txt',
): Promise<[string, boolean]> {
  const strict = new TextDecoder('utf-8', { fatal: true });
  try {
    return [strict.decode(textBytes), false];
  } catch {
    console.warn(`File ${filename} is not UTF-8, fell back to Latin-1`);
    return [Buffer.from(textBytes).toString('latin1'), false];
  }
}
