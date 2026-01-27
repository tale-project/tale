import * as logger from "../utils/logger";
import { getPreviousVersionFilePath } from "./get-previous-version-file-path";

export async function setPreviousVersion(
  deployDir: string,
  version: string
): Promise<void> {
  const versionPath = getPreviousVersionFilePath(deployDir);
  await Bun.write(versionPath, version);
  logger.debug(`Saved previous version: ${version}`);
}
