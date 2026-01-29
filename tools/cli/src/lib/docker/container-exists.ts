import { docker } from "./docker";

export async function containerExists(containerName: string): Promise<boolean> {
  const result = await docker("container", "inspect", "--format", "{{.Id}}", containerName);
  return result.success;
}
