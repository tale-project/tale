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

  const version = result.stdout.trim();
  if (!result.success || !version || version === "<no value>") {
    return null;
  }

  return version;
}
