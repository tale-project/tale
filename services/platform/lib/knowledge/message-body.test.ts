import { describe, expect, it } from 'vitest';

import {
  messageBodyText,
  messageCorpusNames,
  messageCorrespondent,
} from './message-body';

describe('messageBodyText', () => {
  it('reads an HTML body through the tag stripper', () => {
    // The mail lane stores `html || text` and keeps both on the metadata, so
    // the content IS the html part.
    const html =
      '<html><head><style>p{color:red}</style></head><body>' +
      '<p>Applying for the <b>field sales agent</b> role.</p>' +
      '<p>See <a href="https://example.test/cv">my CV</a>.</p></body></html>';
    const text = messageBodyText(html, { html, text: 'plain alternative' });
    expect(text).toContain('Applying for the field sales agent role.');
    expect(text).toContain('[my CV](https://example.test/cv)');
    expect(text).not.toContain('<');
    expect(text).not.toContain('color:red');
  });

  it('keeps a plain-text body exactly as written, angle brackets included', () => {
    const body = 'On Monday, Bob <bob@example.test> wrote:\n> a < b';
    expect(messageBodyText(body, { html: null, text: body })).toBe(body);
    // No envelope at all (a message logged by hand) is plain text too.
    expect(messageBodyText(body, null)).toBe(body);
  });

  it('does not mistake an empty html part for an HTML body', () => {
    const body = 'Just text <here>';
    expect(messageBodyText(body, { html: '', text: body })).toBe(body);
  });

  it('answers empty for a body with nothing readable left', () => {
    const html = '<div><img src="https://example.test/pixel.gif"></div>';
    expect(messageBodyText(html, { html })).toBe('');
    expect(messageBodyText('   \n ', null)).toBe('');
  });
});

describe('messageCorpusNames', () => {
  it('names a hit by its subject and heads every chunk with the subject and sender', () => {
    expect(
      messageCorpusNames({
        subject: 'Application: field sales agent',
        correspondent: 'Bob Example <bob@example.test>',
      }),
    ).toEqual({
      filename: 'Application: field sales agent',
      title:
        'Application: field sales agent — from Bob Example <bob@example.test>',
    });
  });

  it('falls back to who wrote when the mail had no subject', () => {
    expect(messageCorpusNames({ correspondent: 'bob@example.test' })).toEqual({
      filename: 'Email from bob@example.test',
      title: 'Email from bob@example.test',
    });
    expect(messageCorpusNames({ subject: 'Invoice' })).toEqual({
      filename: 'Invoice',
      title: 'Invoice',
    });
    expect(messageCorpusNames({})).toEqual({
      filename: 'Email',
      title: 'Email',
    });
  });

  it('strips what a column cannot store and bounds what an outsider chose', () => {
    const names = messageCorpusNames({
      subject: `Hi\u0000 there\u001b[31m  ${'x'.repeat(400)}`,
      correspondent: '   ',
    });
    expect(names.filename).not.toMatch(/[\u0000-\u0008\u000b\u000e-\u001f]/);
    expect(names.filename.startsWith('Hi there[31m x')).toBe(true);
    expect(names.filename.length).toBeLessThanOrEqual(200);
    // A blank correspondent is no correspondent.
    expect(names.title).toBe(names.filename);
  });
});

describe('messageCorrespondent', () => {
  it('reads the sender off the stored envelope', () => {
    expect(
      messageCorrespondent({
        from: [{ name: 'Bob Example', address: 'bob@example.test' }],
      }),
    ).toBe('Bob Example <bob@example.test>');
    expect(
      messageCorrespondent({ from: [{ address: 'bob@example.test' }] }),
    ).toBe('bob@example.test');
    expect(
      messageCorrespondent({
        from: [{ name: 'bob@example.test', address: 'bob@example.test' }],
      }),
    ).toBe('bob@example.test');
    expect(messageCorrespondent({ from: [{ name: 'Bob' }] })).toBe('Bob');
  });

  it('names nobody when the envelope does not', () => {
    expect(messageCorrespondent(null)).toBeNull();
    expect(messageCorrespondent({ from: [] })).toBeNull();
    expect(messageCorrespondent({ from: 'bob@example.test' })).toBeNull();
    expect(
      messageCorrespondent({ from: [{ name: ' ', address: '' }] }),
    ).toBeNull();
  });
});
