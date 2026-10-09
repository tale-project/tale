/**
 * What people type into the chat composer: questions, instructions,
 * follow-ups that quote the previous reply, long pastes (a report, a CSV, a
 * log), code, lists, emoji and other languages — in the user's own language
 * most of the time. Sizes follow a long tail: most messages are a sentence
 * or two, a few are pastes of up to ~15k characters.
 */

import type { Faker } from '@faker-js/faker';

import type { DataLocale, UserFaker } from './faker.ts';
import {
  type Random,
  chance,
  intBetween,
  pick,
  pickWeighted,
} from './random.ts';

export type PromptKind =
  | 'question'
  | 'instruction'
  | 'follow-up'
  | 'paste'
  | 'code'
  | 'list'
  | 'emoji'
  | 'foreign';

export interface Prompt {
  kind: PromptKind;
  text: string;
}

/** Longest paste a user sends (characters). */
export const MAX_PASTE_CHARS = 15_000;

interface Fill {
  company: string;
  product: string;
  topic: string;
  person: string;
  city: string;
  number: number;
}

function fillFor(faker: Faker, random: Random): Fill {
  return {
    company: faker.company.name(),
    product: faker.commerce.productName(),
    topic: pick(random, TOPICS) ?? 'the quarterly report',
    person: faker.person.firstName(),
    city: faker.location.city(),
    number: intBetween(random, 2, 12),
  };
}

const TOPICS = [
  'the quarterly report',
  'our onboarding process',
  'the customer churn numbers',
  'the pricing page',
  'the support backlog',
  'the vendor contract',
  'the hiring plan',
  'the release notes',
  'the security review',
  'the marketing budget',
] as const;

type Template = (fill: Fill) => string;

const QUESTIONS: Record<DataLocale, readonly Template[]> = {
  en: [
    (f) => `What's the best way to present ${f.topic} to ${f.company}'s board?`,
    (f) => `How should I price ${f.product} for a customer in ${f.city}?`,
    (f) =>
      `Can you explain the difference between gross and net retention, with an example for ${f.company}?`,
    (f) =>
      `Why would ${f.topic} slip by ${f.number} weeks, and what can I do about it?`,
    (f) => `Which risks should ${f.person} watch in ${f.topic}?`,
    (f) => `Is ${f.number} people enough to run support for ${f.product}?`,
  ],
  de: [
    (f) =>
      `Wie präsentiere ich ${f.topic} am besten vor der Geschäftsleitung von ${f.company}?`,
    (f) => `Welchen Preis sollten wir für ${f.product} in ${f.city} ansetzen?`,
    () =>
      'Kannst du mir den Unterschied zwischen Brutto- und Netto-Retention erklären?',
    (f) =>
      `Warum verzögert sich ${f.topic} um ${f.number} Wochen und was kann ich tun?`,
    (f) => `Worauf sollte ${f.person} bei ${f.topic} achten?`,
  ],
  fr: [
    (f) => `Comment présenter ${f.topic} à la direction de ${f.company} ?`,
    (f) => `Quel prix fixer pour ${f.product} à ${f.city} ?`,
    () => "Peux-tu m'expliquer la différence entre rétention brute et nette ?",
    (f) => `Pourquoi ${f.topic} prend-il ${f.number} semaines de retard ?`,
    (f) => `À quoi ${f.person} doit-il faire attention pour ${f.topic} ?`,
  ],
};

const INSTRUCTIONS: Record<DataLocale, readonly Template[]> = {
  en: [
    (f) =>
      `Write a short email to ${f.person} at ${f.company} about ${f.topic}. Friendly but firm.`,
    (f) =>
      `Draft ${f.number} bullet points summarising ${f.topic} for a busy executive.`,
    (f) => `Create a one-page plan to launch ${f.product} in ${f.city}.`,
    (f) =>
      `Rewrite this so it sounds less formal: "We regret to inform you that ${f.topic} is delayed."`,
    (f) =>
      `Make a table comparing ${f.number} options for ${f.topic}, with pros and cons.`,
  ],
  de: [
    (f) =>
      `Schreib eine kurze E-Mail an ${f.person} bei ${f.company} zu ${f.topic}.`,
    (f) =>
      `Fasse ${f.topic} in ${f.number} Stichpunkten für die Geschäftsleitung zusammen.`,
    (f) => `Erstelle einen Einführungsplan für ${f.product} in ${f.city}.`,
    (f) =>
      `Mach eine Tabelle mit ${f.number} Optionen für ${f.topic}, mit Vor- und Nachteilen.`,
  ],
  fr: [
    (f) =>
      `Écris un court e-mail à ${f.person} chez ${f.company} au sujet de ${f.topic}.`,
    (f) => `Résume ${f.topic} en ${f.number} points pour la direction.`,
    (f) => `Prépare un plan de lancement de ${f.product} à ${f.city}.`,
    (f) => `Fais un tableau comparant ${f.number} options pour ${f.topic}.`,
  ],
};

const FOLLOW_UPS: Record<DataLocale, readonly ((quote: string) => string)[]> = {
  en: [
    (q) => `You said "${q}" — can you expand on that?`,
    (q) => `Make that shorter. Especially the part about "${q}".`,
    () => 'Thanks! Can you turn that into three bullet points?',
    () => 'Translate your last answer into German, please.',
    (q) => `I don't agree with "${q}". Why do you think so?`,
    () => 'Great, now give me an example.',
  ],
  de: [
    (q) => `Du hast geschrieben: "${q}" — kannst du das genauer erklären?`,
    () => 'Bitte kürzer und als Stichpunkte.',
    () => 'Übersetz die letzte Antwort bitte ins Englische.',
    (q) => `Bei "${q}" bin ich nicht sicher. Warum?`,
  ],
  fr: [
    (q) => `Tu as écrit « ${q} » — peux-tu développer ?`,
    () => 'Plus court, en trois points, s’il te plaît.',
    () => 'Traduis ta dernière réponse en anglais.',
    (q) => `Je ne suis pas d'accord avec « ${q} ». Pourquoi ?`,
  ],
};

const PASTE_INTROS: Record<DataLocale, readonly string[]> = {
  en: [
    'Summarize this for me:',
    'Here is the report, what are the three key takeaways?',
    'Find the mistakes in this text:',
    'What does this log say went wrong?',
  ],
  de: [
    'Fasse das bitte zusammen:',
    'Was sind die drei wichtigsten Punkte in diesem Bericht?',
    'Finde die Fehler in diesem Text:',
  ],
  fr: [
    'Résume-moi ceci :',
    'Quels sont les trois points clés de ce rapport ?',
    'Trouve les erreurs dans ce texte :',
  ],
};

/** Other languages and scripts — including right-to-left and CJK. */
const FOREIGN: readonly string[] = [
  '¿Puedes resumir el informe trimestral en tres frases?',
  'Puoi scrivere una breve email al cliente sul ritardo della consegna?',
  '四半期レポートの要点を三つ教えてください。',
  '请帮我把这段话翻译成英文：我们下周一开会讨论预算。',
  'هل يمكنك تلخيص تقرير المبيعات لهذا الربع في ثلاث نقاط؟',
  'Можешь кратко объяснить разницу между выручкой и прибылью?',
  'שלום! תוכל לעזור לי לנסח מייל ללקוח?',
  'Kun je dit contract samenvatten in drie zinnen?',
];

const EMOJI = ['🚀', '🙏', '😅', '👍', '🔥', '🤔', '📈', '✅', '💡', '🎉'];

function codeSnippet(faker: Faker, random: Random): string {
  const name = faker.hacker.verb().replace(/\W+/g, '') || 'process';
  const noun = faker.hacker.noun().replace(/\W+/g, '') || 'item';
  const variants = [
    `\`\`\`ts\nexport async function ${name}${capitalize(noun)}(items: ${capitalize(noun)}[]) {\n  const result = [];\n  for (const item of items) {\n    if (item.id = undefined) continue;\n    result.push(await fetch(\`/api/${noun}/\${item.id}\`));\n  }\n  return result.length;\n}\n\`\`\``,
    `\`\`\`python\ndef ${name}_${noun}(rows):\n    total = 0\n    for row in rows:\n        total += row["amount"] / row["count"]\n    return total\n\`\`\``,
    `\`\`\`sql\nSELECT c.name, count(o.id) AS orders\nFROM customers c LEFT JOIN orders o ON o.customer_id = c.id\nWHERE o.created_at > now() - interval '${intBetween(random, 7, 90)} days'\nGROUP BY c.name ORDER BY orders DESC;\n\`\`\``,
  ];
  return pick(random, variants) ?? '';
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A paste of roughly `chars` characters: prose, CSV or a log. */
function pasteBody(faker: Faker, random: Random, chars: number): string {
  const kind = pick(random, ['prose', 'csv', 'log'] as const) ?? 'prose';
  const parts: string[] = [];
  let length = 0;
  if (kind === 'csv') {
    parts.push('date,customer,region,amount,status');
    length += 34;
  }
  while (length < chars) {
    let line: string;
    if (kind === 'prose') {
      line = faker.lorem.paragraph({ min: 3, max: 8 });
    } else if (kind === 'csv') {
      line = `${faker.date.recent({ days: 90 }).toISOString().slice(0, 10)},${faker.company.name().replace(/,/g, '')},${faker.location.state()},${faker.finance.amount()},${pick(random, ['paid', 'open', 'overdue']) ?? 'open'}`;
    } else {
      line = `${faker.date.recent({ days: 2 }).toISOString()} ${pick(random, ['INFO', 'WARN', 'ERROR']) ?? 'INFO'} [${faker.hacker.abbreviation()}] ${faker.hacker.phrase()}`;
    }
    parts.push(line);
    length += line.length + 1;
  }
  return parts.join(kind === 'prose' ? '\n\n' : '\n').slice(0, chars);
}

/** A short quote (≤ 80 chars) from a previous reply, at a word boundary. */
export function quoteFrom(reply: string, random: Random): string | null {
  const sentences = reply
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim().replace(/[*#`|]/g, ''))
    .filter((s) => s.length >= 12);
  const sentence = pick(random, sentences);
  if (sentence === undefined) return null;
  if (sentence.length <= 80) return sentence;
  const cut = sentence.slice(0, 80);
  const space = cut.lastIndexOf(' ');
  return space > 20 ? cut.slice(0, space) : cut;
}

/** One of `templates`, filled; a plain question when the list is empty. */
function fromTemplates(
  random: Random,
  templates: readonly Template[],
  fill: Fill,
): string {
  const template = pick(random, templates);
  return template === undefined ? `What about ${fill.topic}?` : template(fill);
}

const KIND_WEIGHTS: readonly (readonly [PromptKind, number])[] = [
  ['question', 30],
  ['instruction', 25],
  ['list', 8],
  ['code', 8],
  ['paste', 8],
  ['emoji', 8],
  ['foreign', 4],
];

/**
 * The next chat message. With `previousReply`, most messages are
 * follow-ups that quote it, the way a conversation continues.
 */
export function chatPrompt(
  data: UserFaker,
  random: Random,
  previousReply?: string,
): Prompt {
  if (previousReply !== undefined && chance(random, 0.6)) {
    const quote = quoteFrom(previousReply, random) ?? '…';
    const template = pick(random, FOLLOW_UPS[data.locale]);
    if (template !== undefined)
      return { kind: 'follow-up', text: template(quote) };
  }
  const kind = pickWeighted(random, KIND_WEIGHTS) ?? 'question';
  const faker = data.get();
  const fill = fillFor(faker, random);
  switch (kind) {
    case 'question':
      return {
        kind,
        text: fromTemplates(random, QUESTIONS[data.locale], fill),
      };
    case 'instruction':
      return {
        kind,
        text: fromTemplates(random, INSTRUCTIONS[data.locale], fill),
      };
    case 'list': {
      const items = Array.from(
        { length: intBetween(random, 3, 9) },
        () => `- ${faker.company.buzzPhrase()}`,
      );
      return {
        kind,
        text: `Prioritise this list for ${fill.company} and say why:\n${items.join('\n')}`,
      };
    }
    case 'code':
      return {
        kind,
        text: `This doesn't work as expected, can you find the bug?\n\n${codeSnippet(faker, random)}`,
      };
    case 'paste': {
      // Log-uniform between 1k and the cap: most pastes are a page or two.
      const chars = Math.round(1_000 * (MAX_PASTE_CHARS / 1_000) ** random());
      const intro =
        pick(random, PASTE_INTROS[data.locale]) ?? 'Summarize this:';
      return { kind, text: `${intro}\n\n${pasteBody(faker, random, chars)}` };
    }
    case 'emoji': {
      const base = fromTemplates(random, QUESTIONS[data.locale], fill);
      return {
        kind,
        text: `${pick(random, EMOJI) ?? '🙂'} ${base} ${pick(random, EMOJI) ?? '🙂'}`,
      };
    }
    case 'foreign':
      return { kind, text: pick(random, FOREIGN) ?? FOREIGN[0] ?? 'Hola' };
    case 'follow-up':
      return {
        kind: 'question',
        text: fromTemplates(random, QUESTIONS[data.locale], fill),
      };
  }
}

/** A thread title as people name (or rename) their chats. */
export function threadTitle(data: UserFaker, random: Random): string {
  const faker = data.get();
  const options = [
    () =>
      `${capitalize(pick(random, TOPICS) ?? 'notes')} – ${faker.company.name()}`,
    () => `${faker.commerce.productName()} pricing`,
    () => `Email to ${faker.person.firstName()}`,
    () => `${faker.hacker.adjective()} ${faker.hacker.noun()} question`,
    () => `Q${intBetween(random, 1, 4)} ${faker.commerce.department()} plan`,
  ];
  const make = pick(random, options) ?? options[0];
  return (make?.() ?? 'Chat').slice(0, 120);
}
