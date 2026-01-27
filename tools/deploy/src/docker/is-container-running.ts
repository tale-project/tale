import { docker } from "./docker";

export async function isContainerRunning(containerName: string): Promise<boolean> {
  const result = await docker(
    "inspect",
    "--format",
    "{{.State.Running}}",
    containerName
  );
  return result.success && result.stdout.trim() === "true";
}
