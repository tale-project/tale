import { docker } from "./docker";

export async function getContainerHealth(
  containerName: string
): Promise<"healthy" | "unhealthy" | "starting" | "none"> {
  const result = await docker(
    "inspect",
    "--format",
    "{{.State.Health.Status}}",
    containerName
  );

  if (!result.success) {
    return "none";
  }

  const status = result.stdout.trim();
  if (status === "healthy" || status === "unhealthy" || status === "starting") {
    return status;
  }
  return "none";
}
