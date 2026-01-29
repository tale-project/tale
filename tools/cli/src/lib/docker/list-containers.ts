import { docker } from "./docker";

export async function listContainers(
  filter?: string
): Promise<{ name: string; status: string; image: string }[]> {
  const args = ["ps", "-a", "--format", "{{.Names}}\t{{.Status}}\t{{.Image}}"];
  if (filter) {
    args.push("--filter", filter);
  }

  const result = await docker(...args);
  if (!result.success || !result.stdout) {
    return [];
  }

  return result.stdout
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const [name, status, image] = line.split("\t");
      return { name, status, image };
    });
}
