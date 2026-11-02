import { describe, expect, it } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';

import { ApiError } from './client';
import {
  failureText,
  readFailureCause,
  readFailureText,
  sessionFailureText,
} from './failure';

const t = i18n.getFixedT('en', 'errors');
const german = i18n.getFixedT('de', 'errors');
const french = i18n.getFixedT('fr', 'errors');

const CAUSE = 'the proxy rejected the credentials (HTTP 407)';
/** French sets a no-break space before a colon and inside guillemets. */
const NBSP = '\u00a0';

/** A refusal of the backend: its own English sentence, and what it names besides its code. */
function refusal(code: string, extra: Record<string, unknown> = {}) {
  return new ApiError(409, code, 'The backend’s own English sentence.', extra);
}

describe('failureText', () => {
  it('words an error from its code', () => {
    expect(failureText(new ApiError(404, 'session_not_found', 'x'), t)).toBe(
      'This session no longer exists.',
    );
  });

  it('words it in the language of the person', async () => {
    expect(
      failureText(new ApiError(404, 'session_not_found', 'x'), german),
    ).toBe('Diese Sitzung gibt es nicht mehr.');
  });

  it('shows the generic line, not the backend sentence, for a code the app has no wording for', () => {
    const unknown = new ApiError(
      500,
      'something_new',
      'SQLITE_CORRUPT: database disk image is malformed',
    );
    expect(failureText(unknown, t)).toBe('Something went wrong. Try again.');
    // Nor does a person who reads German or French get an English technical text.
    expect(failureText(unknown, german)).toBe(
      'Etwas ist schiefgelaufen. Versuche es erneut.',
    );
    expect(failureText(unknown, french)).toBe(
      "Une erreur s'est produite. Réessaie.",
    );
  });

  it('says what a plain error says when it carries a sentence for the person', () => {
    expect(failureText(new Error('The file is too large.'), t)).toBe(
      'The file is too large.',
    );
  });

  it('shows nothing of a fault: a generic line', () => {
    expect(failureText(new TypeError('x is not a function'), t)).toBe(
      'Something went wrong. Try again.',
    );
    expect(failureText('boom', t)).toBe('Something went wrong. Try again.');
  });

  it('words a lost connection', () => {
    expect(
      failureText(
        new ApiError(0, 'network', 'Cannot reach the session manager.'),
        t,
      ),
    ).toBe(
      "Can't reach Session Manager. Check that it's running, then try again.",
    );
  });

  it.each([
    [
      'server_error',
      'Session Manager answered with an error. Try again.',
      'Session Manager hat mit einem Fehler geantwortet. Versuche es erneut.',
      'Session Manager a répondu par une erreur. Réessaie.',
    ],
    [
      'bad_answer',
      "Session Manager sent an answer this page can't read. Reload the page.",
      'Session Manager hat eine Antwort geschickt, die diese Seite nicht lesen kann. Lade die Seite neu.',
      'Session Manager a envoyé une réponse que cette page ne peut pas lire. Recharge la page.',
    ],
  ])(
    'words %s, a failure only the page can make, in every language',
    (code, english, germanText, frenchText) => {
      // Whatever the page puts in the message (a status line, a parser's complaint) is never shown.
      const error = new ApiError(502, code, 'Bad Gateway', { status: 502 });
      expect(failureText(error, t)).toBe(english);
      expect(failureText(error, german)).toBe(germanText);
      expect(failureText(error, french)).toBe(frenchText);
    },
  );

  it('never prints the backend sentence of a code it words, nor what else the answer holds', () => {
    const text = failureText(
      refusal('session_not_found', {
        session: { id: 3, name: 'Secret name' },
        exitIp: '203.0.113.7',
      }),
      t,
    );
    expect(text).toBe('This session no longer exists.');
  });
});

describe('failureText: a proxy that is not working', () => {
  it('says why, in the words of the proxy check', () => {
    expect(
      failureText(
        refusal('proxy_unreachable', { proxyId: 4, reason: CAUSE }),
        t,
      ),
    ).toBe(
      `This session's proxy isn't working: ${CAUSE}. Choose Rotate IP to give the session another proxy.`,
    );
  });

  it('says why in German, with the cause as the check worded it', () => {
    expect(
      failureText(
        refusal('proxy_unreachable', { proxyId: 4, reason: CAUSE }),
        german,
      ),
    ).toBe(
      `Der Proxy dieser Sitzung funktioniert nicht: ${CAUSE}. Wähle IP wechseln, damit die Sitzung einen anderen Proxy bekommt.`,
    );
  });

  it('says why in French, with the cause as the check worded it', () => {
    expect(
      failureText(
        refusal('proxy_unreachable', { proxyId: 4, reason: CAUSE }),
        french,
      ),
    ).toBe(
      `Le proxy de cette session ne fonctionne pas${NBSP}: ${CAUSE}. Choisis Changer d'IP pour lui donner un autre proxy.`,
    );
  });

  it('says only that it is not working when the backend names no cause (older data, MCP)', () => {
    const generic =
      "This session's proxy isn't working. Choose Rotate IP to give the session another proxy.";
    expect(failureText(refusal('proxy_unreachable'), t)).toBe(generic);
    expect(failureText(refusal('proxy_unreachable', { proxyId: 4 }), t)).toBe(
      generic,
    );
    expect(failureText(refusal('proxy_unreachable'), german)).toBe(
      'Der Proxy dieser Sitzung funktioniert nicht. Wähle IP wechseln, damit die Sitzung einen anderen Proxy bekommt.',
    );
  });

  it.each([
    ['an object', { text: 'x' }],
    ['a list', ['x']],
    ['a number', 407],
    ['a boolean', true],
    ['nothing', null],
    ['an empty text', ''],
    ['a text of blanks', ' \n\t '],
    ['only a full stop', '.'],
  ])('takes %s for no cause', (_what, reason) => {
    expect(failureText(refusal('proxy_unreachable', { reason }), t)).toBe(
      "This session's proxy isn't working. Choose Rotate IP to give the session another proxy.",
    );
  });

  it('puts the cause on one line, trimmed, with no full stop of its own at the end', () => {
    expect(
      failureText(
        refusal('proxy_unreachable', {
          reason: '  cannot connect to the proxy\n\t(timed out) after 8 s. ',
        }),
        t,
      ),
    ).toBe(
      "This session's proxy isn't working: cannot connect to the proxy (timed out) after 8 s. Choose Rotate IP to give the session another proxy.",
    );
  });

  it('drops control and invisible characters from the cause', () => {
    const text = failureText(
      refusal('proxy_unreachable', {
        reason: 'refused\u0000\u202e (407)\u200b',
      }),
      t,
    );
    expect(text).toContain("isn't working: refused (407). Choose");
  });

  it('cuts a cause that runs on, and says it was cut', () => {
    const text = failureText(
      refusal('proxy_unreachable', { reason: `${'a'.repeat(500)} tail` }),
      t,
    );
    expect(text).toContain(`${'a'.repeat(299)}…. Choose Rotate IP`);
    expect(text).not.toContain('tail');
  });

  it('keeps a cause that has the shape of a message as the text it is', () => {
    const reason =
      '{count, plural, one {# proxy} other {# proxies}} {name} $t(fallback)';
    expect(failureText(refusal('proxy_unreachable', { reason }), t)).toContain(
      `isn't working: ${reason}. Choose Rotate IP`,
    );
  });

  it('never prints the sentence the backend sent along', () => {
    expect(
      failureText(
        new ApiError(
          502,
          'proxy_unreachable',
          'The proxy of session shop (http://user@192.0.2.1:8080) is not working.',
          { proxyId: 4 },
        ),
        t,
      ),
    ).not.toContain('shop');
  });
});

describe('failureText: no working proxy', () => {
  it.each([
    [
      1,
      'No working proxy is available (1 proxy failed its check). Add proxies or check the existing ones, then try again.',
    ],
    [
      3,
      'No working proxy is available (3 proxies failed their check). Add proxies or check the existing ones, then try again.',
    ],
  ])('counts the proxies that failed their check: %d', (failed, sentence) => {
    expect(failureText(refusal('no_working_proxy', { failed }), t)).toBe(
      sentence,
    );
  });

  it('counts them in German, with the plural of the language', () => {
    expect(
      failureText(refusal('no_working_proxy', { failed: 1 }), german),
    ).toBe(
      'Es ist kein funktionierender Proxy verfügbar (1 Proxy hat die Prüfung nicht bestanden). Füge Proxies hinzu oder prüfe die vorhandenen und versuche es dann erneut.',
    );
    expect(
      failureText(refusal('no_working_proxy', { failed: 3 }), german),
    ).toBe(
      'Es ist kein funktionierender Proxy verfügbar (3 Proxies haben die Prüfung nicht bestanden). Füge Proxies hinzu oder prüfe die vorhandenen und versuche es dann erneut.',
    );
  });

  it('counts them in French, with the plural of the language', () => {
    expect(
      failureText(refusal('no_working_proxy', { failed: 1 }), french),
    ).toBe(
      "Aucun proxy fonctionnel n'est disponible (1 proxy a échoué à la vérification). Ajoute des proxys ou vérifie ceux qui existent, puis réessaie.",
    );
    expect(
      failureText(refusal('no_working_proxy', { failed: 3 }), french),
    ).toBe(
      "Aucun proxy fonctionnel n'est disponible (3 proxys ont échoué à la vérification). Ajoute des proxys ou vérifie ceux qui existent, puis réessaie.",
    );
  });

  it('says no count when the backend names none: none failed, or older data', () => {
    const generic =
      'No working proxy is available. Add proxies or check the existing ones, then try again.';
    expect(failureText(refusal('no_working_proxy'), t)).toBe(generic);
    expect(failureText(refusal('no_working_proxy', { failed: 0 }), t)).toBe(
      generic,
    );
  });

  it.each([
    ['a negative number', -2],
    ['a fraction', 1.5],
    ['a text', '3'],
    ['not a number', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
    ['a number too large to count', 1e21],
    ['an object', { count: 3 }],
    ['nothing', null],
  ])('takes %s for no count', (_what, failed) => {
    expect(failureText(refusal('no_working_proxy', { failed }), t)).toBe(
      'No working proxy is available. Add proxies or check the existing ones, then try again.',
    );
  });
});

describe('failureText: an exit IP without a place', () => {
  it('says why, in the words of the lookup', () => {
    const reason = 'the GeoIP database has no location for 203.0.113.7';
    expect(failureText(refusal('unknown_ip_location', { reason }), t)).toBe(
      `Couldn't find the time zone and location of the proxy's exit IP: ${reason}.`,
    );
    expect(
      failureText(refusal('unknown_ip_location', { reason }), german),
    ).toBe(
      `Zeitzone und Standort der Ausgangs-IP des Proxys konnten nicht ermittelt werden: ${reason}.`,
    );
    expect(
      failureText(refusal('unknown_ip_location', { reason }), french),
    ).toBe(
      `Impossible de déterminer le fuseau horaire et la position de l'IP de sortie du proxy${NBSP}: ${reason}.`,
    );
  });

  it('says only that the place cannot be found when the backend names no cause', () => {
    expect(failureText(refusal('unknown_ip_location'), t)).toBe(
      "Couldn't find the time zone and location of the proxy's exit IP.",
    );
    expect(failureText(refusal('unknown_ip_location', { reason: 5 }), t)).toBe(
      "Couldn't find the time zone and location of the proxy's exit IP.",
    );
  });
});

describe('failureText: a busy session', () => {
  it.each([
    [
      'assigning_proxy',
      'This session is getting a proxy. Try again in a moment.',
    ],
    ['starting', 'This session is starting. Try again in a moment.'],
    ['stopping', 'This session is stopping. Try again in a moment.'],
  ])('says what it is doing: %s', (doing, sentence) => {
    expect(failureText(refusal('session_busy', { doing }), t)).toBe(sentence);
  });

  it('says what it is doing in German and in French', () => {
    expect(
      failureText(
        refusal('session_busy', { doing: 'assigning_proxy' }),
        german,
      ),
    ).toBe(
      'Dieser Sitzung wird gerade ein Proxy zugewiesen. Versuche es gleich noch einmal.',
    );
    expect(
      failureText(refusal('session_busy', { doing: 'stopping' }), german),
    ).toBe('Diese Sitzung stoppt gerade. Versuche es gleich noch einmal.');
    expect(
      failureText(refusal('session_busy', { doing: 'starting' }), french),
    ).toBe(
      'Cette session est en cours de démarrage. Réessaie dans un instant.',
    );
    expect(
      failureText(
        refusal('session_busy', { doing: 'assigning_proxy' }),
        french,
      ),
    ).toBe(
      "Un proxy est en cours d'attribution à cette session. Réessaie dans un instant.",
    );
  });

  it.each([
    ['nothing said', undefined],
    ['something the app does not know', 'rotating'],
    ['a number', 7],
    ['an object', { what: 'starting' }],
    ['a prefix of a key', 'assigning'],
  ])('says only that it is busy for %s', (_what, doing) => {
    expect(failureText(refusal('session_busy', { doing }), t)).toBe(
      'This session is busy. Try again in a moment.',
    );
  });
});

describe('sessionFailureText', () => {
  it.each([
    ['proxy_unreachable', { proxyId: 4, reason: CAUSE }],
    ['proxy_unreachable', null],
    ['no_working_proxy', { failed: 2 }],
    ['no_working_proxy', null],
    ['unknown_ip_location', { reason: 'no location for 203.0.113.7' }],
    ['unknown_ip_location', null],
    ['no_proxy', null],
  ])(
    'words the failure of a session as the refusal of its code was worded: %s %j',
    (errorCode, errorExtra) => {
      const worded = sessionFailureText({ errorCode, errorExtra }, t);
      expect(worded).toBe(failureText(refusal(errorCode, errorExtra ?? {}), t));
      expect(worded).not.toBeNull();
    },
  );

  it('words it in the language of the person', () => {
    expect(
      sessionFailureText(
        { errorCode: 'no_working_proxy', errorExtra: { failed: 3 } },
        german,
      ),
    ).toContain('3 Proxies haben die Prüfung nicht bestanden');
  });

  it('has no words for a failure with no code, or a code the app does not know', () => {
    expect(
      sessionFailureText({ errorCode: null, errorExtra: null }, t),
    ).toBeNull();
    expect(
      sessionFailureText({ errorCode: 'launch_failed', errorExtra: null }, t),
    ).toBeNull();
  });
});

/** The failures that only say to try again, which the button beside a failed read already says. */
const ONLY_A_RETRY_CASES: [string, unknown][] = [
  ['no answer at all', new ApiError(0, 'network', 'x')],
  ['an error of the server', new ApiError(500, 'internal_error', 'x')],
  [
    'an answer that is no JSON of the app',
    new ApiError(502, 'server_error', 'x'),
  ],
  ['a code the app has no words for', new ApiError(500, 'something_new', 'x')],
  ['a fault of the page', new TypeError('x is not a function')],
];

describe('readFailureCause', () => {
  it.each(ONLY_A_RETRY_CASES)(
    'names no cause for %s: the Try again beside it is the way on, and the banner says why',
    (_what, error) => {
      expect(readFailureCause(error, t)).toBeNull();
    },
  );

  it('names a cause that Try again does not mend, in the language of the person', () => {
    const forbidden = new ApiError(403, 'forbidden_host', 'x');
    expect(readFailureCause(forbidden, t)).toBe(
      'Open Session Manager at 127.0.0.1 or localhost.',
    );
    expect(readFailureCause(forbidden, german)).toBe(
      'Öffne Session Manager über 127.0.0.1 oder localhost.',
    );
    expect(readFailureCause(forbidden, french)).toBe(
      "Ouvre Session Manager à l'adresse 127.0.0.1 ou localhost.",
    );
  });

  it('keeps the answer a page cannot read, whose way on is not a second try', () => {
    expect(readFailureCause(new ApiError(502, 'bad_answer', 'x'), t)).toBe(
      "Session Manager sent an answer this page can't read. Reload the page.",
    );
  });
});

describe('readFailureText', () => {
  const lead = "Couldn't load the settings.";

  it.each(ONLY_A_RETRY_CASES)(
    'says only what could not be loaded for %s: the Try again beside it is the way on, and the banner says why',
    (_what, error) => {
      expect(readFailureText(lead, error, t)).toBe(lead);
    },
  );

  it('adds what the answer says when it names a cause that Try again does not mend', () => {
    expect(
      readFailureText(lead, new ApiError(403, 'forbidden_host', 'x'), t),
    ).toBe(
      "Couldn't load the settings. Open Session Manager at 127.0.0.1 or localhost.",
    );
    expect(
      readFailureText(lead, new ApiError(404, 'secret_not_found', 'x'), t),
    ).toBe("Couldn't load the settings. This secret no longer exists.");
  });

  it('keeps the answer a page cannot read, whose way on is not a second try', () => {
    expect(readFailureText(lead, new ApiError(502, 'bad_answer', 'x'), t)).toBe(
      "Couldn't load the settings. Session Manager sent an answer this page can't read. Reload the page.",
    );
  });

  it('adds what a plain error says when it carries a sentence for the person', () => {
    expect(readFailureText(lead, new Error('The file is too large.'), t)).toBe(
      "Couldn't load the settings. The file is too large.",
    );
  });

  it('words it in the language of the person, with one space between the two sentences', () => {
    const forbidden = new ApiError(403, 'forbidden_host', 'x');
    expect(
      readFailureText(
        'Die Einstellungen konnten nicht geladen werden.',
        forbidden,
        german,
      ),
    ).toBe(
      'Die Einstellungen konnten nicht geladen werden. Öffne Session Manager über 127.0.0.1 oder localhost.',
    );
    expect(
      readFailureText(
        'Impossible de charger les paramètres.',
        forbidden,
        french,
      ),
    ).toBe(
      "Impossible de charger les paramètres. Ouvre Session Manager à l'adresse 127.0.0.1 ou localhost.",
    );
    expect(
      readFailureText(
        'Die Einstellungen konnten nicht geladen werden.',
        new ApiError(500, 'internal_error', 'x'),
        german,
      ),
    ).toBe('Die Einstellungen konnten nicht geladen werden.');
  });
});
