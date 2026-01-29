import { docker } from "./docker";

export async function containerExists(containerName: string): Promise<boolean> {
  const result = await docker("inspect", "--format", "{{.Id}}", containerName);
  return result.success;
}
