import { docker } from "./docker";

export async function getContainerVersion(
  containerName: string
): Promise<string | null> {
  const result = await docker(
    "inspect",
    "--format",
    '{{index .Config.Labels "org.opencontainers.image.version"}}',
    containerName
  );

  if (!result.success || !result.stdout.trim()) {
    return null;
  }

  return result.stdout.trim();
}
