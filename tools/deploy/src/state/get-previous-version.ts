import { existsSync } from "node:fs";
import { getPreviousVersionFilePath } from "./get-previous-version-file-path";

export async function getPreviousVersion(
  deployDir: string
): Promise<string | null> {
  const versionPath = getPreviousVersionFilePath(deployDir);

  if (!existsSync(versionPath)) {
    return null;
  }

  const content = await Bun.file(versionPath).text();
  return content.trim() || null;
}
