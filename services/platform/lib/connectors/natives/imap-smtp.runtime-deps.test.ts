/**
 * The `imap-smtp` connector's runtime dependencies must LOAD, not merely be
 * listed.
 *
 * `imap-smtp.test.ts` covers the resolvers by handing them synthetic module
 * shapes — `{ ImapFlow: class {} }` and friends. That is the right way to
 * test the interop logic, and it is also why a tree that cannot load these
 * packages at all passes the whole suite.
 *
 * It happened: a tree-wide `linkify-it` override put version 6 under
 * `mailparser`, which pins 5 and calls `require('linkify-it')()`. linkify-it 6
 * resolves under `require` to a namespace object rather than a callable, so
 * `mailparser` threw while loading and `get_message` failed for every mailbox.
 * Nothing was ingested. Sending kept working, because it uses nodemailer and
 * never loads mailparser, so the product looked healthy while replies stopped
 * arriving.
 *
 * So these tests import the real packages and hand them to the real resolvers.
 * They fail on the installed tree, which is the only place this class of
 * breakage exists — a version pin, an override, or a hoist, never the source.
 */

import { describe, expect, it } from 'vitest';

import {
  resolveImapFlowConstructor,
  resolveNodemailerCreateTransport,
  resolveSimpleParser,
} from './imap-smtp.ts';

describe('the mail libraries load from the installed tree', () => {
  it('mailparser resolves a usable simpleParser', async () => {
    const parser = resolveSimpleParser(await import('mailparser'));
    expect(typeof parser).toBe('function');
  });

  it('mailparser parses a message end to end', async () => {
    // Importing the entry is not enough: the linkify-it break happened in a
    // transitive require while `mail-parser.js` was still initialising, and
    // parsing is what pulls that path in.
    const parser = resolveSimpleParser(await import('mailparser'));
    const parsed = await parser(
      'From: sender@example.test\r\nSubject: runtime deps\r\n\r\nbody\r\n',
    );
    expect(parsed.subject).toBe('runtime deps');
  });

  it('imapflow resolves a constructable ImapFlow', async () => {
    const ImapFlow = resolveImapFlowConstructor(await import('imapflow'));
    expect(typeof ImapFlow).toBe('function');
  });

  it('nodemailer resolves a usable createTransport', async () => {
    const createTransport = resolveNodemailerCreateTransport(
      await import('nodemailer'),
    );
    expect(typeof createTransport).toBe('function');
  });
});
