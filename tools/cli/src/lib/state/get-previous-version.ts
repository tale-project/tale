import { getPreviousVersionFilePath } from "./get-previous-version-file-path";

export async function getPreviousVersion(
  deployDir: string
): Promise<string | null> {
  const versionPath = getPreviousVersionFilePath(deployDir);

  try {
    const content = await Bun.file(versionPath).text();
    return content.trim() || null;
  } catch {
    return null;
  }
}
