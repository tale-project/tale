/** The lines of a list that hold something: blank ones do not count. */
export function countLines(text: string): number {
  return text.split(/\r\n|[\n\r]/).filter((line) => line.trim() !== '').length;
}
