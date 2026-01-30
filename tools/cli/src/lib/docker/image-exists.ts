import { docker } from "./docker";

export async function imageExists(image: string): Promise<boolean> {
  const result = await docker("image", "inspect", image);
  return result.success;
}
