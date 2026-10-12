/**
 * The work tools — what an agent turn calls to produce something rather
 * than to look something up: a file it writes out, an image, a skill's
 * instructions, code in a light sandbox.
 *
 * One table for every lane that offers them: the chat assistant's turn
 * today, the native task turn on the same runtime. Each entry carries its
 * execution tier (`tiers.ts`), the JSON Schema of its arguments, the
 * model-facing description that is the tool's contract — when to call it,
 * when not to, what comes back — and the one-line doc the system prompt
 * lists. The descriptions are where the tier decision is steered, so they
 * name the cheaper tool to use instead wherever one exists.
 *
 * Layer A: pure data — no `node:*`, no I/O — so the executors, the wire
 * shaping and the tests all read one table.
 */

import type { ToolDoc } from '../chat/context';
import type { WireTool } from '../chat/tools';
import type { ExecutionTier } from './tiers';

export const WORK_TOOL_NAMES = [
  'create_file',
  'generate_image',
  'load_skill',
  'read_skill_file',
  'run_code',
] as const;

export type WorkToolName = (typeof WORK_TOOL_NAMES)[number];

export function isWorkToolName(name: string): name is WorkToolName {
  return (WORK_TOOL_NAMES as readonly string[]).includes(name);
}

// ------------------------------------------------------------------ limits

/** The largest file `create_file` stores, in UTF-8 bytes. */
export const CREATE_FILE_MAX_BYTES = 1024 * 1024;

/** Images one `generate_image` call may create. */
export const GENERATE_IMAGE_COUNT_MAX = 4;
/** Reference images one call may start from. */
export const GENERATE_IMAGE_INPUTS_MAX = 4;
/** Long enough for any image brief; image models ignore the rest. */
export const GENERATE_IMAGE_PROMPT_MAX_CHARS = 4_000;

/** A window of a skill file `read_skill_file` returns, in characters. */
export const SKILL_FILE_WINDOW_CHARS = 20_000;

export const RUN_CODE_LANGUAGES = ['python', 'node', 'bash'] as const;
export type RunCodeLanguage = (typeof RUN_CODE_LANGUAGES)[number];
/** The longest program one call runs, in characters. */
export const RUN_CODE_MAX_CODE_CHARS = 100_000;
/** Files one call may copy into the sandbox. */
export const RUN_CODE_MAX_INPUT_FILES = 10;
/** Skills one call may copy into the sandbox. */
export const RUN_CODE_MAX_SKILLS = 4;
export const RUN_CODE_DEFAULT_TIMEOUT_SECONDS = 60;
/** Well inside the turn's liveness window: a turn shows no progress while
 * a tool runs, and its watchdog takes a turn silent for ten minutes. */
export const RUN_CODE_MAX_TIMEOUT_SECONDS = 180;
/** Output files one call delivers; the rest are reported as skipped. */
export const RUN_CODE_MAX_OUTPUT_FILES = 10;
/** The tail of stdout and stderr each that a result relays. */
export const RUN_CODE_OUTPUT_TAIL_CHARS = 6_000;

/** Where a light sandbox keeps what the tools put there and take back. */
export const LIGHT_SANDBOX_PATHS = {
  workspace: '/agent/workspace',
  output: '/agent/output',
  inputs: '/agent/inputs',
  skills: '/agent/skills',
  code: '/agent/code',
} as const;

// ------------------------------------------------------------------ schemas

function object(
  properties: Record<string, Record<string, unknown>>,
  required: readonly string[] = [],
): Record<string, unknown> {
  return {
    type: 'object',
    properties,
    ...(required.length > 0 && { required: [...required] }),
    additionalProperties: false,
  };
}

const refList = (description: string, maxItems: number) => ({
  type: 'array',
  items: { type: 'string' },
  maxItems,
  description,
});

const CREATE_FILE_SCHEMA = object(
  {
    name: {
      type: 'string',
      description:
        'The file name the user receives, with its extension, e.g. ' +
        '"meeting-notes.md" or "contacts.csv". The extension decides the ' +
        'type.',
    },
    content: {
      type: 'string',
      description: 'The complete content of the file, exactly as stored.',
    },
  },
  ['name', 'content'],
);

const GENERATE_IMAGE_SCHEMA = object(
  {
    prompt: {
      type: 'string',
      description:
        'What to draw: subject, style, composition, colours, and any text ' +
        `the image must show. At most ${GENERATE_IMAGE_PROMPT_MAX_CHARS} ` +
        'characters.',
    },
    size: {
      type: 'string',
      description:
        '"square" (default), "landscape" (3:2) or "portrait" (2:3); a ' +
        'shape such as "16:9" is read by its orientation.',
    },
    count: {
      type: 'integer',
      minimum: 1,
      maximum: GENERATE_IMAGE_COUNT_MAX,
      description: `How many images to create (default 1, at most ${GENERATE_IMAGE_COUNT_MAX}).`,
    },
    inputImages: refList(
      'Refs of images already in this conversation — an uploaded image or ' +
        'one created earlier — to edit or take as reference.',
      GENERATE_IMAGE_INPUTS_MAX,
    ),
  },
  ['prompt'],
);

const LOAD_SKILL_SCHEMA = object(
  {
    name: {
      type: 'string',
      description:
        'The skill name exactly as the skill list in your instructions ' +
        'gives it, e.g. "docx".',
    },
  },
  ['name'],
);

const READ_SKILL_FILE_SCHEMA = object(
  {
    name: { type: 'string', description: 'The skill name.' },
    path: {
      type: 'string',
      description:
        'The file path inside the skill, exactly as load_skill listed it.',
    },
    offset: {
      type: 'integer',
      minimum: 0,
      description:
        'Character offset to continue from — the "nextOffset" a truncated ' +
        'read reported.',
    },
  },
  ['name', 'path'],
);

const RUN_CODE_SCHEMA = object(
  {
    language: {
      type: 'string',
      enum: [...RUN_CODE_LANGUAGES],
      description:
        '"python" (Python 3.12), "node" (Node.js 24, CommonJS — use ' +
        'require) or "bash".',
    },
    code: {
      type: 'string',
      description:
        'The complete program. It runs in /agent/workspace; write every ' +
        'file the user should receive to /agent/output/.',
    },
    files: refList(
      'Refs of files from this conversation (uploads, or files created ' +
        'earlier) to copy to /agent/inputs/ before the program runs.',
      RUN_CODE_MAX_INPUT_FILES,
    ),
    skills: refList(
      'Names of skills whose bundled files (scripts, templates) the ' +
        'program uses; each is copied to /agent/skills/<name>/.',
      RUN_CODE_MAX_SKILLS,
    ),
    timeoutSeconds: {
      type: 'integer',
      minimum: 5,
      maximum: RUN_CODE_MAX_TIMEOUT_SECONDS,
      description: `How long the program may run (default ${RUN_CODE_DEFAULT_TIMEOUT_SECONDS}, at most ${RUN_CODE_MAX_TIMEOUT_SECONDS} seconds).`,
    },
  },
  ['language', 'code'],
);

// ------------------------------------------------------------ descriptions

const DESCRIPTIONS: Record<WorkToolName, string> = {
  create_file:
    'Save a file whose complete content you can write out yourself, and ' +
    'attach it to the conversation for the user to download: Markdown, ' +
    'plain text, CSV or TSV, JSON, YAML, XML, HTML, SVG, an .ics calendar ' +
    'entry, a .vcf contact card, or source code. Instant — no sandbox ' +
    'starts. Use it when the user asks for such a file, or when a long ' +
    'structured result (hundreds of table rows, a whole document) serves ' +
    'better as a file than in your reply. The extension of "name" decides ' +
    'the type; binary formats (DOCX, XLSX, PPTX, PDF, PNG, ZIP) cannot be ' +
    'typed out — make those with run_code. Write the whole content in one ' +
    `call, at most ${CREATE_FILE_MAX_BYTES / (1024 * 1024)} MB. Answers ` +
    "with the file's ref. Afterwards, tell the user the file is attached " +
    'rather than repeating its content.',
  generate_image:
    "Create images with the organization's image model and attach them " +
    'to the conversation. For pictures: illustrations, photographs, ' +
    'artwork, logos, mock-ups. Not for charts, diagrams or documents — ' +
    'draw those with run_code, or write an SVG with create_file. No ' +
    'sandbox starts, but generation can take a minute. Answers with each ' +
    "image's ref and its size in pixels — report those, not the size you " +
    'asked for.',
  load_skill:
    "Read a skill from the user's skill library: its instructions and the " +
    'list of files bundled with it. A skill is a tested procedure for a ' +
    'kind of work — a document format, a house style, a checklist; the ' +
    'skills available are listed in your instructions. Load the matching ' +
    'skill before doing work it covers, and follow it. Loading runs ' +
    'nothing: to use a skill’s scripts or templates, name the skill in ' +
    'run_code’s "skills" and its files are at /agent/skills/<name>/.',
  read_skill_file:
    'Read one text file bundled with a skill — a reference, an example, a ' +
    `template — as a window of up to ${SKILL_FILE_WINDOW_CHARS} characters; ` +
    '"offset" continues a truncated read. Use the paths load_skill listed. ' +
    'Binary files (images, archives, Office files) cannot be read here: use ' +
    'them from run_code with the skill in "skills".',
  run_code:
    'Run Python, Node.js or Bash in a light sandbox — an isolated Linux ' +
    'machine that starts in about a second — to make files and compute ' +
    'results: Word, Excel, PowerPoint and PDF documents, charts, data ' +
    'analysis, conversions, and edits of files the user uploaded. ' +
    'Preinstalled: Python 3.12 with pandas, numpy, openpyxl, xlsxwriter, ' +
    'python-pptx, python-docx, reportlab, pypdf, pdfplumber, Pillow and ' +
    'matplotlib; Node.js 24 with docx and pptxgenjs; LibreOffice ' +
    '(soffice), pandoc with XeLaTeX, and poppler (pdftoppm, pdftotext). ' +
    'Installing other packages works but is slow — prefer what is there. ' +
    'Write each file the user should receive to /agent/output/: when the ' +
    'call ends, every file there that is new or changed is attached to the ' +
    'conversation, and it stays in place, so a later call can check or ' +
    'convert it. Keep working files in /agent/workspace/, the working ' +
    'directory. The machine keeps its files between calls for a few ' +
    'minutes, then starts over empty. ' +
    'Answers with the exit code, the end of stdout and stderr, and the ' +
    'attached files. Do not use it for what you can answer or type out ' +
    'yourself.',
};

const DOCS: Record<WorkToolName, string> = {
  create_file:
    'attach a text file you write out (Markdown, CSV, JSON, HTML, SVG, code)',
  generate_image: 'create images with the image model',
  load_skill: "read a skill's instructions and file list",
  read_skill_file: 'read a text file bundled with a skill',
  run_code:
    'run Python, Node.js or Bash in a light sandbox to make documents, charts and other files',
};

const SCHEMAS: Record<WorkToolName, Record<string, unknown>> = {
  create_file: CREATE_FILE_SCHEMA,
  generate_image: GENERATE_IMAGE_SCHEMA,
  load_skill: LOAD_SKILL_SCHEMA,
  read_skill_file: READ_SKILL_FILE_SCHEMA,
  run_code: RUN_CODE_SCHEMA,
};

const TIERS: Record<WorkToolName, ExecutionTier> = {
  create_file: 'none',
  generate_image: 'none',
  load_skill: 'none',
  read_skill_file: 'none',
  run_code: 'light',
};

/** The tier a work tool runs in. */
export function workToolTier(name: WorkToolName): ExecutionTier {
  return TIERS[name];
}

/** The provider-wire definition of one work tool. */
export function workWireTool(name: WorkToolName): WireTool {
  return {
    name,
    description: DESCRIPTIONS[name],
    parameters: SCHEMAS[name],
  };
}

/** The system prompt's one line for one work tool. */
export function workToolDoc(name: WorkToolName): ToolDoc {
  return { id: name, description: DOCS[name] };
}
