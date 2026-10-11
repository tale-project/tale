/**
 * The work ladder — the instruction that tells a turn how to choose between
 * answering, writing a file, generating an image and running code.
 *
 * The tools' own descriptions carry each contract; this block carries the
 * ORDER, which no single description can: the cheapest way that does the
 * job wins, and a costlier tier is never reached for out of habit. It names
 * only the tools the turn is actually offered, so an organization that
 * switched code execution off never reads about a sandbox it cannot use.
 *
 * It rides the agent instructions, inside the cached prefix: it changes
 * only with the organization's policy, never per person or per turn.
 *
 * Layer A: pure data.
 */

/** Which work tools a turn offers. */
export interface WorkLoadout {
  readonly createFile: boolean;
  readonly generateImage: boolean;
  readonly skills: boolean;
  readonly runCode: boolean;
}

/** True when the loadout offers any work tool at all. */
export function offersWork(loadout: WorkLoadout): boolean {
  return (
    loadout.createFile ||
    loadout.generateImage ||
    loadout.skills ||
    loadout.runCode
  );
}

/**
 * The ladder for `loadout`, or `undefined` when it offers no work tool —
 * then a turn's instructions stay exactly what they were without any.
 */
export function renderWorkLadder(loadout: WorkLoadout): string | undefined {
  if (!offersWork(loadout)) return undefined;
  const steps: string[] = [
    'your reply — prose, a Markdown table, a short code block.',
  ];
  if (loadout.createFile) {
    steps.push(
      'create_file — a file whose content you can write out yourself: Markdown, CSV, JSON, HTML, SVG, plain text, code. No sandbox.',
    );
  }
  if (loadout.generateImage) {
    steps.push(
      'generate_image — a picture: an illustration, a photo-like scene, artwork, a logo.',
    );
  }
  if (loadout.runCode) {
    steps.push(
      'run_code — the light sandbox, for a Word, Excel, PowerPoint or PDF file, a chart, a calculation over data, a conversion, or a change to an uploaded file.',
    );
  }
  const lines = [
    '**MAKING THINGS** — reach for the cheapest way that does the job, in this order:',
    ...steps.map((step, index) => `${index + 1}. ${step}`),
  ];
  if (loadout.skills) {
    lines.push(
      'When a skill in the list below matches the work, load it with load_skill before you start and follow it — the document skills (docx, xlsx, pptx, pdf) say how to build those files well.',
    );
  }
  lines.push(
    'Never use a costlier step than the work needs, and never claim a file you did not make. When files are attached, say so in a sentence and do not paste their content again.',
  );
  return lines.join('\n');
}
