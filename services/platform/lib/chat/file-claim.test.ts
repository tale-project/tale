import { describe, expect, it } from 'vitest';

import { claimsAttachedFile, fileNotAttached } from './file-claim';
import type { MessagePart } from './types';

describe('claimsAttachedFile [CHAT-R35]', () => {
  it.each([
    "I've attached the SVG.",
    'I have attached the report below.',
    'I’ve also attached a CSV with the raw numbers.',
    'I just attached planets.csv.',
    "I'm attaching the spreadsheet now.",
    'I drew the hero and attached it.',
    'I wrote hero.svg and attached it.',
    'Please find attached the Q3 report.',
    '**Attached:** `hero.svg`',
    'Here you go.\nAttached is the file you asked for.',
    "You'll find it attached below.",
    'Attached below is the CSV.',
  ])('reads an English claim: %s', (text) => {
    expect(claimsAttachedFile(text)).toBe(true);
  });

  it.each([
    'Ich habe dir die Datei angehängt.',
    'Die SVG-Datei habe ich beigefügt.',
    'Ich habe die Datei erstellt und angehängt.',
    'Ich schicke dir die Tabelle anbei.',
    'Anbei die Grafik als PNG.',
    'Im Anhang findest du die Tabelle.',
    'Die Tabelle findest du im Anhang.',
  ])('reads a German claim: %s', (text) => {
    expect(claimsAttachedFile(text)).toBe(true);
  });

  it.each([
    "J'ai joint le fichier SVG.",
    'J’ai également joint le tableau.',
    'Je vous ai joint le fichier.',
    'Je te l’ai jointe.',
    'Je vous joins le tableau.',
    'Ci-joint le rapport demandé.',
    'Vous trouverez ci-joint le rapport.',
    'Tu trouveras le tableau en pièce jointe.',
  ])('reads a French claim: %s', (text) => {
    expect(claimsAttachedFile(text)).toBe(true);
  });

  it.each([
    'The PDF you sent is attached to your message, and it lists three items.',
    'The spreadsheet you attached has 12 rows.',
    'The attached PDF says the deadline is May 3.',
    'I read the attached document twice.',
    'You attached it twice, so I read it once.',
    "You've attached them already.",
    'You exported the sheet and attached it.',
    'I think you exported the sheet and attached it.',
    'You’ll find the totals in the attached spreadsheet.',
    'The document you attached below lists three risks.',
    'The document attached below covers three topics.',
    'I can see your file is attached.',
    'Die Datei, die du angehängt hast, enthält drei Tabellen.',
    'Sie haben eine PDF-Datei angehängt; darin geht es um Q3.',
    'Im Anhang deiner Nachricht steht eine CSV-Datei mit 12 Zeilen.',
    'Die Zahlen findest du im Anhang deiner Nachricht.',
    'Ich habe die Datei gelesen, die du angehängt hast.',
    'Danke für die angehängte Datei.',
    'Le document en pièce jointe contient trois sections.',
    'Tu trouveras les chiffres dans le document en pièce jointe.',
    "J'ai lu le document en pièce jointe.",
    'Voici un résumé du document ci-joint.',
    'Merci pour le fichier que vous avez joint.',
  ])("reads no claim in words about the person's own upload: %s", (text) => {
    expect(claimsAttachedFile(text)).toBe(false);
  });

  it.each([
    'Once the file is attached, press Send.',
    'Make sure the file is attached.',
    'Attached files can be at most 10 MB each.',
    'You can attach files with the paperclip.',
    'La probabilité jointe vaut 0,3.',
    'Return it within 30 days.',
  ])('reads no claim in how-to or other text: %s', (text) => {
    expect(claimsAttachedFile(text)).toBe(false);
  });

  it('reads a long reply quickly', () => {
    const startedAt = performance.now();
    expect(claimsAttachedFile(`${'i '.repeat(60_000)}and so on`)).toBe(false);
    expect(claimsAttachedFile('findest du '.repeat(20_000))).toBe(false);
    expect(performance.now() - startedAt).toBeLessThan(2_000);
  });
});

describe('fileNotAttached [CHAT-R35]', () => {
  const call = (capabilityId: string): MessagePart => ({
    type: 'tool-call',
    callId: 'call_1',
    capabilityId,
    input: {},
  });
  const result = (capabilityId: string, output: unknown): MessagePart => ({
    type: 'tool-result',
    callId: 'call_1',
    capabilityId,
    output,
    structured: true,
  });
  const text = (value: string): MessagePart => ({ type: 'text', text: value });
  const SVG: MessagePart = {
    type: 'artifact',
    fileId: 's3:org/hero',
    name: 'hero.svg',
    mediaType: 'image/svg+xml',
    sizeBytes: 812,
    callId: 'call_1',
  };
  const FAILED = { status: 'invalid_args', message: '"content" is empty.' };

  it('holds when a file tool stored nothing and the reply claims a file', () => {
    expect(
      fileNotAttached([
        call('create_file'),
        result('create_file', FAILED),
        text('The SVG file is attached.'),
      ]),
    ).toBe(true);
  });

  it('holds when a file tool stored nothing, whatever the reply says', () => {
    expect(
      fileNotAttached([
        call('generate_image'),
        result('generate_image', { status: 'error', message: 'No answer.' }),
        text('Voilà ton héros.'),
      ]),
    ).toBe(true);
  });

  it('holds when code ran, stored nothing, and the reply claims a file', () => {
    expect(
      fileNotAttached([
        call('run_code'),
        result('run_code', { status: 'ok', stdout: 'wrote /tmp/planets.csv' }),
        text("I've attached planets.csv."),
      ]),
    ).toBe(true);
  });

  it('never holds while the reply carries a file', () => {
    expect(
      fileNotAttached([
        call('create_file'),
        result('create_file', FAILED),
        call('create_file'),
        result('create_file', { status: 'ok' }),
        SVG,
        text('The SVG file is attached.'),
      ]),
    ).toBe(false);
  });

  it('does not hold on words alone: a letter the reply drafts', () => {
    expect(
      fileNotAttached([
        text('Hi Anna,\n\nPlease find attached the Q3 report.\n\nBest, Max'),
      ]),
    ).toBe(false);
  });

  it('does not hold for a reply that speaks of no file', () => {
    expect(fileNotAttached([])).toBe(false);
    expect(fileNotAttached([text('Return it within 30 days.')])).toBe(false);
    expect(
      fileNotAttached([
        call('run_code'),
        result('run_code', { status: 'ok', stdout: '4.2' }),
        text('The mean is 4.2.'),
      ]),
    ).toBe(false);
    expect(
      fileNotAttached([
        call('run_code'),
        result('run_code', { status: 'ok', stdout: '12' }),
        text('The spreadsheet you attached has 12 rows.'),
      ]),
    ).toBe(false);
  });
});
