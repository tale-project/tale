import { join } from 'node:path';

import { isTaleProject, type TaleProject } from './types';

export async function readProject(dir: string): Promise<TaleProject> {
  const filePath = join(dir, 'tale.json');
  const file = Bun.file(filePath);
  const exists = await file.exists();

  if (!exists) {
    throw new Error(`No tale.json found in ${dir}`);
  }

  const content = await file.json();

  if (!isTaleProject(content)) {
    throw new Error(`Invalid tale.json in ${dir}`);
  }

  return content;
}
