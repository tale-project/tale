/**
 * Image files carried by a paste, renamed `pasted-image-N.<ext>` — the ONE
 * clipboard extraction the chat composer and the task modal both attach
 * with. Clipboards often ship a text/alt fallback beside the image bytes; a
 * caller that gets a non-empty result prevents the default paste so that
 * fallback never lands as prose the user never wrote. `nextIndex` is the
 * caller's own counter (a ref), so names stay unique across pastes within
 * one surface without this module holding state.
 */
export function extractPastedImageFiles(
  data: DataTransfer,
  nextIndex: () => number,
): File[] {
  const files: File[] = [];
  for (const item of data.items) {
    if (!item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file === null) continue;
    const extension = item.type.split('/')[1] ?? 'png';
    files.push(
      new File([file], `pasted-image-${nextIndex()}.${extension}`, {
        type: file.type,
      }),
    );
  }
  return files;
}
