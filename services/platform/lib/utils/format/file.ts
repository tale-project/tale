export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function middleEllipsis(name: string, maxLength: number): string {
  if (name.length <= maxLength) return name;
  const extIndex = name.lastIndexOf('.');
  const ext = extIndex > 0 ? name.slice(extIndex) : '';
  const base = extIndex > 0 ? name.slice(0, extIndex) : name;
  const available = maxLength - ext.length - 1; // 1 for the ellipsis char
  if (available < 4) return name.slice(0, maxLength - 1) + '\u2026';
  const front = Math.ceil(available / 2);
  const back = Math.floor(available / 2);
  return base.slice(0, front) + '\u2026' + base.slice(-back) + ext;
}
