/**
 * Whether a settled reply speaks of a file it does not carry.
 *
 * A reply's text and its files settle apart: the files ride the reply as
 * `artifact` parts, lifted from what its tool calls stored, while its text
 * is whatever the model wrote. Nothing but the instructions held the two
 * together, so a reply could say "the file is attached" over a call that
 * failed, a call the reply cap withheld, or a code run that stored nothing.
 * The turn reads the reply against its files with `fileNotAttached` and
 * stamps the verdict on the reply; the client says under it that no file
 * was attached.
 *
 * The tool record decides, and only when the reply carries no file: a call
 * of a tool whose only work is storing a file stored nothing; or a code run
 * stored nothing while the reply's text claims a file. A code run needs the
 * claim because a calculation stores nothing by design. Words alone mark
 * nothing: a letter the reply drafts, a sentence it translates or the
 * person's words it quotes say "I've attached" too.
 *
 * Layer A: pure — no I/O.
 */

import type { WorkToolName } from '../agent/work-tools';
import type { MessagePart } from './types';

/** The work tools that exist only to store a file: a call of one that left
 * the reply without a file did not do its work. */
const FILE_TOOLS: ReadonlySet<string> = new Set<WorkToolName>([
  'create_file',
  'generate_image',
]);

/** The work tool that stores a file only when its code writes one. */
const CODE_TOOL: WorkToolName = 'run_code';

/** A run of text within one clause: no sentence end, semicolon, colon,
 * comma or line break, except inside a name like `hero.svg`. The forms that
 * span a clause read at most 80 such characters, so a long reply stays fast. */
const CLAUSE = String.raw`(?:[^.!?;:,\n]|[.:,](?=\S))`;

/**
 * The forms a reply claims a file of its own with, in English, German and
 * French, over text lowercased with its apostrophes straightened and its
 * emphasis marks removed: the first person, or a phrase a writer uses only
 * of their own enclosure. A participle or a passive also describes the
 * person's upload ("the PDF you sent is attached to your message", "die
 * Datei, die du angehängt hast", "le document en pièce jointe") or how to
 * attach one ("once the file is attached"), so none of them reads as one.
 */
const CLAIM_FORMS: readonly RegExp[] = [
  // English, the first person: "I've attached", "I just attached", "I'm
  // attaching", "I drew the hero and attached it" (no "you" in between).
  /\bi(?:'ve| have)?(?: also| now| just)? attached\b/,
  /\bi(?:'m| am)(?: also| now)? attaching\b/,
  new RegExp(
    String.raw`\bi\b(?:(?!\byou)${CLAUSE}){0,80}\band attached (?:it|them)\b`,
  ),
  // English, a writer's own enclosure: "please find attached", "Attached:"
  // or "Attached is" opening a sentence, "attached below" closing a clause.
  /\bplease find attached\b/,
  /(?:^|[.!?]\s)attached(?::| is\b| are\b)/m,
  /(?<!\byou(?:'ve| have)? )\battached below(?= is\b| are\b|\s*(?:[.!:;,)]|$))/m,
  // German, the first person: "ich habe dir … angehängt", "die Tabelle habe
  // ich beigefügt", "ich schicke dir … anbei" (no "du" in between).
  new RegExp(
    String.raw`\b(?:ich (?:habe?|sende|schicke)|(?:habe?|sende|schicke) ich)\b(?:(?!\b(?:du\b|dein))${CLAUSE}){0,80}\b(?:angehängt|beigefügt|anbei)(?![\p{L}\p{N}])`,
    'u',
  ),
  // German, a writer's own enclosure: "Anbei …" or "Im Anhang findest du …"
  // opening a sentence, "… findest du im Anhang" closing a clause.
  /(?:^|[.!?]\s)(?:anbei|im anhang (?:findest du|finden sie|findet ihr))\b/m,
  new RegExp(
    String.raw`\b(?:findest du|finden sie|findet ihr|du findest|sie finden|ihr findet)\b${CLAUSE}{0,80}?\b(?:im anhang|anbei|angehängt|beigefügt)(?=\s*(?:[.!?;:,)]|$))`,
    'mu',
  ),
  // French, the first person: "j'ai joint", "je vous ai joint", "je te
  // l'ai jointe", "je vous joins".
  /\b(?:j'ai|je (?:(?:te |vous )?(?:l'|les )|t'|vous )ai)(?: aussi| également| bien)? joint(?:e|s|es)?\b/,
  /\bje (?:te |vous )?joins\b/,
  // French, a writer's own enclosure: "Ci-joint …" opening a sentence, "vous
  // trouverez ci-joint", "tu trouveras le tableau en pièce jointe".
  /(?:^|[.!?]\s)ci-joint/m,
  /\b(?:tu trouveras|vous trouverez)(?: [^\s.!?;:,]+){0,2} (?:ci-joint(?:e|s|es)?|en pièces? jointes?)(?![\p{L}\p{N}])/u,
];

/** True when `text` claims, in the voice of its writer, that a file is
 * attached to it. */
export function claimsAttachedFile(text: string): boolean {
  const plain = text
    .toLowerCase()
    .replace(/[’‘ʼ]/g, "'")
    .replace(/[*_~`]/g, '')
    .replace(/[^\S\n]+/g, ' ');
  return CLAIM_FORMS.some((form) => form.test(plain));
}

/**
 * True when a reply's settled `parts` speak of a file they do not carry: no
 * `artifact` part, and either a call of a file tool, or a code run beside
 * text that claims an attachment.
 */
export function fileNotAttached(parts: readonly MessagePart[]): boolean {
  if (parts.some((part) => part.type === 'artifact')) return false;
  const calls = parts.flatMap((part) =>
    part.type === 'tool-call' ? [part.capabilityId] : [],
  );
  if (calls.some((tool) => FILE_TOOLS.has(tool))) return true;
  return (
    calls.includes(CODE_TOOL) &&
    parts.some((part) => part.type === 'text' && claimsAttachedFile(part.text))
  );
}
