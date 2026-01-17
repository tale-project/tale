/**
 * Extract file extension from a filename
 *
 * Returns the extension in lowercase without the leading dot.
 * Returns undefined if no extension is found.
 *
 * @example
 * extractExtension('report.pdf') // 'pdf'
 * extractExtension('presentation.PPTX') // 'pptx'
 * extractExtension('README') // undefined
 * extractExtension('.gitignore') // 'gitignore'
 */
export function extractExtension(filename?: string): string | undefined {
  if (!filename) {
    return undefined;
  }

  // Find the last dot in the filename
  const lastDotIndex = filename.lastIndexOf('.');

  // No dot found, or dot is at the start (hidden files like .gitignore)
  if (lastDotIndex === -1) {
    return undefined;
  }

  // Handle hidden files like ".gitignore" - the extension is after the dot
  if (lastDotIndex === 0) {
    const ext = filename.slice(1).toLowerCase();
    return ext.length > 0 ? ext : undefined;
  }

  // Extract and normalize the extension
  const extension = filename.slice(lastDotIndex + 1).toLowerCase();

  // Return undefined if extension is empty (filename ends with a dot)
  return extension.length > 0 ? extension : undefined;
}

