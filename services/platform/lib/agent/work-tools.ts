/**
 * The work tools — what an agent turn calls to produce something rather
 * than to look something up: a file it writes out, an image, a skill's
 * instructions, code in a light sandbox.
 *
 * One table for every lane that offers them: the chat assistant's turn and
 * a task agent's native turn, which run on the same engine. Each entry carries its
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
  'use_workspace',
] as const;

export type WorkToolName = (typeof WORK_TOOL_NAMES)[number];

export function isWorkToolName(name: string): name is WorkToolName {
  return (WORK_TOOL_NAMES as readonly string[]).includes(name);
}

/** The statuses a work tool answers a call it could not carry out with: the
 * executors' failure type and a run's log, which shows a result carrying one
 * as an error entry, both read this one list. */
export const WORK_TOOL_FAILURE_STATUSES = [
  'invalid_args',
  'not_found',
  'unavailable',
  'busy',
  'error',
  'cancelled',
] as const;

export type WorkToolFailureStatus = (typeof WORK_TOOL_FAILURE_STATUSES)[number];

/** Why a call failed, where its status alone does not say it to a person:
 * the light sandbox's state, or what became of the program. Rides the
 * failure beside its status, and the reply's step names it. */
export const WORK_TOOL_FAILURE_REASONS = [
  /** Every light sandbox of the organization is running code (`busy`). */
  'sandboxes_busy',
  /** The sandbox host is at its capacity (`busy`). */
  'sandbox_host_busy',
  /** The sandbox host has no runtime image yet, so nothing starts
   * (`unavailable`). */
  'sandbox_not_ready',
  /** The sandbox service did not answer (`unavailable`). */
  'sandbox_unreachable',
  /** The sandbox failed to start, or stopped under the program
   * (`unavailable`). */
  'sandbox_failed',
  /** The program ended with an error (`error`). */
  'program_failed',
  /** The program, or the step it ran in, ran out of time (`error`). */
  'timed_out',
] as const;

export type WorkToolFailureReason = (typeof WORK_TOOL_FAILURE_REASONS)[number];

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

/** The longest reason `use_workspace` takes, in characters. */
export const USE_WORKSPACE_REASON_MAX_CHARS = 500;
/** The longest hand-over brief `use_workspace` takes, in characters. */
export const USE_WORKSPACE_BRIEF_MAX_CHARS = 4_000;

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

const USE_WORKSPACE_SCHEMA = object(
  {
    reason: {
      type: 'string',
      maxLength: USE_WORKSPACE_REASON_MAX_CHARS,
      description:
        'Why the other tools cannot do this: what the work needs that they ' +
        'lack, in one sentence.',
    },
    brief: {
      type: 'string',
      maxLength: USE_WORKSPACE_BRIEF_MAX_CHARS,
      description:
        'What the full workspace needs to carry on without seeing this ' +
        'conversation: what was asked, what you already did and made, what ' +
        'remains.',
    },
  },
  ['reason', 'brief'],
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
    'typed out{binary}. Write the whole content in one ' +
    `call, at most ${CREATE_FILE_MAX_BYTES / (1024 * 1024)} MB. Answers ` +
    "with the file's ref. Afterwards, tell the user the file is attached " +
    'rather than repeating its content.',
  generate_image:
    "Create images with the organization's image model and attach them " +
    'to the conversation. For pictures: illustrations, photographs, ' +
    'artwork, logos, mock-ups. Not for charts, diagrams or documents' +
    '{drawing}. No ' +
    'sandbox starts, but generation can take a minute. Answers with each ' +
    "image's ref and its size in pixels — report those, not the size you " +
    'asked for.',
  load_skill:
    "Read a skill from the user's skill library: its instructions and the " +
    'list of files bundled with it. A skill is a tested procedure for a ' +
    'kind of work — a document format, a house style, a checklist; the ' +
    'skills available are listed in your instructions. Load the matching ' +
    'skill before doing work it covers, and follow it. Loading runs ' +
    'nothing{scripts}.',
  read_skill_file:
    'Read one text file bundled with a skill — a reference, an example, a ' +
    `template — as a window of up to ${SKILL_FILE_WINDOW_CHARS} characters; ` +
    '"offset" continues a truncated read. Use the paths load_skill listed. ' +
    'Binary files (images, archives, Office files) cannot be read here' +
    '{binaryFiles}.',
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
  use_workspace:
    'Hand this task to the full workspace: a persistent Linux environment ' +
    'with a shell, network access, git and a browser, where a coding agent ' +
    'carries the work on for as long as it takes. It costs a full sandbox ' +
    'and the most time, so it is the last resort: use it only when the work ' +
    'cannot be done with your other tools — a repository to clone, build or ' +
    'test, a browser session, a long-running or interactive process, work ' +
    'over many files or hours. Never for a document, a spreadsheet, a ' +
    'chart, an image or a file you can write out yourself: create_file and ' +
    'run_code make those faster. Give the reason, and a brief the agent can ' +
    'act on without seeing this conversation. After the call, end your ' +
    'turn with one short sentence: the hand-over takes it from there.',
};

const DOCS: Record<WorkToolName, string> = {
  create_file:
    'attach a text file you write out (Markdown, CSV, JSON, HTML, SVG, code)',
  generate_image: 'create images with the image model',
  load_skill: "read a skill's instructions and file list",
  read_skill_file: 'read a text file bundled with a skill',
  run_code:
    'run Python, Node.js or Bash in a light sandbox to make documents, charts and other files',
  use_workspace:
    'hand the task to the full workspace (shell, git, browser) when the work needs it',
};

const SCHEMAS: Record<WorkToolName, Record<string, unknown>> = {
  create_file: CREATE_FILE_SCHEMA,
  generate_image: GENERATE_IMAGE_SCHEMA,
  load_skill: LOAD_SKILL_SCHEMA,
  read_skill_file: READ_SKILL_FILE_SCHEMA,
  run_code: RUN_CODE_SCHEMA,
  use_workspace: USE_WORKSPACE_SCHEMA,
};

const TIERS: Record<WorkToolName, ExecutionTier> = {
  create_file: 'none',
  generate_image: 'none',
  load_skill: 'none',
  read_skill_file: 'none',
  run_code: 'light',
  use_workspace: 'full',
};

/** The tier a work tool runs in. */
export function workToolTier(name: WorkToolName): ExecutionTier {
  return TIERS[name];
}

/** The other work tools a turn offers, as far as a description points at
 * them: a description never sends the model to a tool it does not have. */
export interface WorkToolPeers {
  readonly createFile: boolean;
  readonly runCode: boolean;
}

const ALL_PEERS: WorkToolPeers = { createFile: true, runCode: true };

/** The words each description's `{slot}` takes, for the peers offered. */
function peerPhrases(peers: WorkToolPeers): Record<string, string> {
  const drawing = [
    ...(peers.runCode ? ['draw those with run_code'] : []),
    ...(peers.createFile ? ['write an SVG with create_file'] : []),
  ].join(', or ');
  return {
    binary: peers.runCode ? ' — make those with run_code' : '',
    drawing: drawing === '' ? '' : ` — ${drawing}`,
    scripts: peers.runCode
      ? ': to use a skill’s scripts or templates, name the skill in ' +
        'run_code’s "skills" and its files are at /agent/skills/<name>/'
      : ', and a skill’s scripts cannot run here: follow its instructions ' +
        'with your other tools',
    binaryFiles: peers.runCode
      ? ': use them from run_code with the skill in "skills"'
      : '',
  };
}

/** The provider-wire definition of one work tool, its description written
 * for the other work tools the turn offers. */
export function workWireTool(
  name: WorkToolName,
  peers: WorkToolPeers = ALL_PEERS,
): WireTool {
  const phrases = peerPhrases(peers);
  return {
    name,
    description: DESCRIPTIONS[name].replace(
      /\{(\w+)\}/g,
      (slot: string, key: string) => phrases[key] ?? slot,
    ),
    parameters: SCHEMAS[name],
  };
}

/** The system prompt's one line for one work tool. */
export function workToolDoc(name: WorkToolName): ToolDoc {
  return { id: name, description: DOCS[name] };
}
