import { docker } from "./docker";

export async function getContainerVersion(
  containerName: string
): Promise<string | null> {
  const result = await docker(
    "container",
    "inspect",
    "--format",
    '{{index .Config.Labels "org.opencontainers.image.version"}}',
    containerName
  );

  if (!result.success) {
    return null;
  }
  const version = result.stdout.trim();
  if (!version || version === "<no value>") {
    return null;
  }

  return version;
}
