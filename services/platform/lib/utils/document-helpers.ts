/**
 * Get file extension from filename
 * @param filename - Name of the file
 * @returns File extension in uppercase
 */
export function getFileExtension(filename: string): string {
  try {
    // If it's a URL (absolute or relative), use URL APIs to safely strip query/hash
    const url = new URL(filename, 'http://local'); // base handles relative paths
    const pathname = url.pathname || '';
    const lastSegment = pathname.split('/').pop() || '';
    const ext = lastSegment.includes('.')
      ? lastSegment.split('.').pop()
      : undefined;
    return ext ? ext.toUpperCase() : 'FILE';
  } catch {
    // Fallback: not a valid URL, treat as plain filename
    const clean = filename.split('?')[0].split('#')[0];
    const lastSegment = clean.split('/').pop() || '';
    const ext = lastSegment.includes('.')
      ? lastSegment.split('.').pop()
      : undefined;
    return ext ? ext.toUpperCase() : 'FILE';
  }
}
