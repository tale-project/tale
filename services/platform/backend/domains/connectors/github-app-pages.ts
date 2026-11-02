import { createHash } from 'node:crypto';

import { parseAcceptLanguage } from '@tale/ui/i18n/accept-language';
import {
  baseLocaleOf,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '@tale/ui/i18n/locales';
import he from 'he';

import { basePath } from '../../core/lib/helpers/public_origin.ts';

/**
 * The pages a person sees on the GitHub App round trips
 * (`github-app-routes.ts`): the hand-off that posts the app's manifest to
 * GitHub, and the outcome a return could not turn into a saved credential.
 *
 * Every sentence is fixed copy, in each locale the platform ships (chosen by
 * `Accept-Language`, like `core/http_connectors/error_page.ts`). What the
 * request or GitHub brings is escaped, and only ever shown as a quotation:
 * GitHub's own refusal message, the app's name, Tale's reason for refusing a
 * credential. A registration's code and a state token never reach a page
 * (the routes strip the code from GitHub's message). The pages carry no
 * external reference and say so in their Content-Security-Policy; the
 * hand-off runs exactly one script, by its hash, and may post only to
 * GitHub.
 */

export type GithubAppPageKind =
  /** The register door's app name or GitHub organization is unusable. */
  | 'invalid_details'
  /** The credential the registration would create cannot exist (the
   * connector takes no GitHub App, or the name is unusable or taken). */
  | 'cannot_register'
  /** A register or install door was opened from another site. */
  | 'cross_site'
  /** `SITE_URL` is unset: GitHub would have nowhere to send the browser. */
  | 'not_configured'
  /** A registration's state is missing, unknown, used, expired or not the
   * returning member's. */
  | 'register_expired'
  /** The same, for an installation. */
  | 'install_expired'
  /** The member is no longer an admin of the organization. */
  | 'forbidden'
  /** GitHub would not trade the registration's code for the app. */
  | 'github_refused'
  /** GitHub registered the app, but Tale could not store it. */
  | 'register_storage_failed'
  /** The credential is gone, or not a GitHub App credential. */
  | 'credential_missing'
  /** GitHub's return names no usable installation id. */
  | 'installation_missing'
  /** The installation is not one of this credential's app. */
  | 'installation_wrong_app'
  /** GitHub does not know the installation. */
  | 'installation_not_found'
  /** The installation is suspended on GitHub. */
  | 'installation_suspended'
  /** GitHub refused the app's read of the installation, or answered it
   * without one. */
  | 'installation_refused'
  /** GitHub could not be reached. */
  | 'github_unreachable'
  /** A return without state names an installation no credential the member
   * administers holds. */
  | 'installation_unknown'
  /** The installation was requested from a GitHub organization's owners. */
  | 'install_requested'
  /** A return without state, in a browser not signed in to Tale. */
  | 'signed_out';

interface Copy {
  readonly title: string;
  readonly detail: string;
}

const STATUS: Record<GithubAppPageKind, number> = {
  invalid_details: 400,
  cannot_register: 400,
  cross_site: 403,
  not_configured: 503,
  register_expired: 400,
  install_expired: 400,
  forbidden: 403,
  github_refused: 502,
  register_storage_failed: 500,
  credential_missing: 404,
  installation_missing: 400,
  installation_wrong_app: 409,
  installation_not_found: 404,
  installation_suspended: 409,
  installation_refused: 502,
  github_unreachable: 502,
  installation_unknown: 404,
  install_requested: 200,
  signed_out: 401,
};

const COPY: Record<SupportedLocale, Record<GithubAppPageKind, Copy>> = {
  en: {
    invalid_details: {
      title: 'These details cannot register a GitHub App',
      detail:
        'The app name must have 1 to 34 characters, and a GitHub organization, when you name one, must be its login. Nothing was sent to GitHub. Go back to your connector settings, check the details and register again.',
    },
    cannot_register: {
      title: 'This GitHub App cannot be registered',
      detail:
        'Tale cannot create this credential, so nothing was sent to GitHub. Go back to your connector settings and register again.',
    },
    cross_site: {
      title: 'Start this in Tale',
      detail:
        'This was opened from a link on another website, so you were not sent to GitHub and nothing was saved. Open your connector settings and start again there.',
    },
    not_configured: {
      title: 'Tale’s public address is not set',
      detail:
        'GitHub sends you back to Tale’s public address, and this deployment has none, so nothing was sent to GitHub. An operator sets it with SITE_URL.',
    },
    register_expired: {
      title: 'This registration link has expired',
      detail:
        'A registration completes once, for the person who started it, within 15 minutes, so nothing was saved in Tale. Register again from your connector settings.',
    },
    install_expired: {
      title: 'This installation link has expired',
      detail:
        'An installation completes once, for the person who started it, within 15 minutes, so nothing was saved in Tale. Open your connector settings and select Install on GitHub again.',
    },
    forbidden: {
      title: 'Only an admin can finish this',
      detail:
        'Your access to this organization changed while you were on GitHub, so nothing was saved in Tale. Only the organization’s owners and admins can register or install a GitHub App.',
    },
    github_refused: {
      title: 'GitHub did not hand over the new app',
      detail:
        'Without it Tale cannot sign anything, so nothing was saved. Register again from your connector settings.',
    },
    register_storage_failed: {
      title: 'The app could not be saved in Tale',
      detail:
        'GitHub created the app, but Tale could not store it, so Tale cannot use it. Register again from your connector settings.',
    },
    credential_missing: {
      title: 'This credential cannot be installed',
      detail:
        'It was removed, or it is not a GitHub App credential, so nothing changed. Check your connector settings.',
    },
    installation_missing: {
      title: 'GitHub did not say which installation',
      detail:
        'GitHub sent you back without an installation, so nothing was saved. Open your connector settings and select Install on GitHub again.',
    },
    installation_wrong_app: {
      title: 'That installation belongs to another app',
      detail:
        'GitHub says this installation is not one of this credential’s app, so nothing was saved. Open your connector settings and select Install on GitHub to install the right app.',
    },
    installation_not_found: {
      title: 'GitHub does not know this installation',
      detail:
        'It may have been removed on GitHub, so nothing was saved. Open your connector settings and select Install on GitHub again.',
    },
    installation_suspended: {
      title: 'This installation is suspended',
      detail:
        'It is suspended on GitHub, so Tale cannot use it and nothing was saved. Unsuspend it among the installed GitHub Apps of its account on GitHub, then select Install on GitHub again in your connector settings.',
    },
    installation_refused: {
      title: 'GitHub did not confirm this installation',
      detail:
        'Tale reads every installation with the app’s own key before it stores it, and GitHub did not answer that read, so nothing was saved. Try again from your connector settings in a few minutes.',
    },
    github_unreachable: {
      title: 'GitHub could not be reached',
      detail:
        'Nothing was saved. Try again from your connector settings in a few minutes.',
    },
    installation_unknown: {
      title: 'Tale has no GitHub App credential for this installation',
      detail:
        'None of the organizations you administer in Tale has a GitHub App credential with this installation, so nothing was saved. If you installed the app from GitHub, open your connector settings in Tale and select Install on GitHub there.',
    },
    install_requested: {
      title: 'The installation waits for approval',
      detail:
        'GitHub asked an owner of the GitHub organization to approve this installation, so nothing changed in Tale yet. Once they have approved it, select Install on GitHub again in your connector settings, and Tale picks up the installation.',
    },
    signed_out: {
      title: 'Sign in to Tale to finish',
      detail:
        'GitHub sent you back, but this browser is not signed in to Tale, so nothing was saved. Sign in, open your connector settings and select Install on GitHub again.',
    },
  },
  de: {
    invalid_details: {
      title: 'Mit diesen Angaben lässt sich keine GitHub App registrieren',
      detail:
        'Der App-Name braucht 1 bis 34 Zeichen, und für eine GitHub-Organisation, wenn du eine angibst, ist ihr Login nötig. Es wurde nichts an GitHub gesendet. Prüfe die Angaben in deinen Connector-Einstellungen und registriere erneut.',
    },
    cannot_register: {
      title: 'Diese GitHub App kann nicht registriert werden',
      detail:
        'Tale kann diese Zugangsdaten nicht anlegen. Deshalb wurde nichts an GitHub gesendet. Registriere erneut in deinen Connector-Einstellungen.',
    },
    cross_site: {
      title: 'Starte das in Tale',
      detail:
        'Das wurde über einen Link auf einer anderen Website geöffnet. Deshalb wurdest du nicht zu GitHub weitergeleitet, und es wurde nichts gespeichert. Öffne deine Connector-Einstellungen und starte dort erneut.',
    },
    not_configured: {
      title: 'Die öffentliche Adresse von Tale ist nicht gesetzt',
      detail:
        'GitHub leitet dich zur öffentlichen Adresse von Tale zurück, und diese Tale-Instanz hat keine. Deshalb wurde nichts an GitHub gesendet. Ein Betreiber setzt sie mit SITE_URL.',
    },
    register_expired: {
      title: 'Dieser Registrierungslink ist abgelaufen',
      detail:
        'Eine Registrierung gilt nur einmal, nur für die Person, die sie gestartet hat, und nur 15 Minuten lang. Deshalb wurde in Tale nichts gespeichert. Registriere erneut in deinen Connector-Einstellungen.',
    },
    install_expired: {
      title: 'Dieser Installationslink ist abgelaufen',
      detail:
        'Eine Installation gilt nur einmal, nur für die Person, die sie gestartet hat, und nur 15 Minuten lang. Deshalb wurde in Tale nichts gespeichert. Öffne deine Connector-Einstellungen und installiere die App dort erneut auf GitHub.',
    },
    forbidden: {
      title: 'Nur Admins können das fertigstellen',
      detail:
        'Dein Zugriff auf diese Organisation hat sich geändert, während du auf GitHub warst. Deshalb wurde in Tale nichts gespeichert. Nur Inhaber und Admins der Organisation können eine GitHub App registrieren oder installieren.',
    },
    github_refused: {
      title: 'GitHub hat die neue App nicht übergeben',
      detail:
        'Ohne sie kann Tale nichts signieren. Deshalb wurde nichts gespeichert. Registriere erneut in deinen Connector-Einstellungen.',
    },
    register_storage_failed: {
      title: 'Die App konnte in Tale nicht gespeichert werden',
      detail:
        'GitHub hat die App angelegt, aber Tale konnte sie nicht speichern und kann sie deshalb nicht nutzen. Registriere erneut in deinen Connector-Einstellungen.',
    },
    credential_missing: {
      title: 'Diese Zugangsdaten können nicht installiert werden',
      detail:
        'Sie wurden entfernt oder gehören nicht zu einer GitHub App. Deshalb hat sich nichts geändert. Prüfe deine Connector-Einstellungen.',
    },
    installation_missing: {
      title: 'GitHub hat keine Installation genannt',
      detail:
        'GitHub hat dich ohne Installation zurückgeschickt. Deshalb wurde nichts gespeichert. Öffne deine Connector-Einstellungen und installiere die App dort erneut auf GitHub.',
    },
    installation_wrong_app: {
      title: 'Diese Installation gehört zu einer anderen App',
      detail:
        'Laut GitHub gehört diese Installation nicht zur App dieser Zugangsdaten. Deshalb wurde nichts gespeichert. Öffne deine Connector-Einstellungen und installiere dort die richtige App.',
    },
    installation_not_found: {
      title: 'GitHub kennt diese Installation nicht',
      detail:
        'Vielleicht wurde sie auf GitHub entfernt. Deshalb wurde nichts gespeichert. Öffne deine Connector-Einstellungen und installiere die App dort erneut auf GitHub.',
    },
    installation_suspended: {
      title: 'Diese Installation ist gesperrt',
      detail:
        'Sie ist auf GitHub gesperrt. Deshalb kann Tale sie nicht nutzen, und es wurde nichts gespeichert. Hebe die Sperre bei den installierten GitHub Apps ihres Kontos auf GitHub auf und installiere die App danach erneut aus deinen Connector-Einstellungen.',
    },
    installation_refused: {
      title: 'GitHub hat diese Installation nicht bestätigt',
      detail:
        'Tale liest jede Installation mit dem eigenen Schlüssel der App, bevor es sie speichert, und GitHub hat diese Abfrage nicht beantwortet. Deshalb wurde nichts gespeichert. Versuche es in ein paar Minuten erneut aus deinen Connector-Einstellungen.',
    },
    github_unreachable: {
      title: 'GitHub war nicht erreichbar',
      detail:
        'Es wurde nichts gespeichert. Versuche es in ein paar Minuten erneut aus deinen Connector-Einstellungen.',
    },
    installation_unknown: {
      title: 'Tale hat keine Zugangsdaten für diese Installation',
      detail:
        'Keine der Organisationen, die du in Tale verwaltest, hat Zugangsdaten einer GitHub App mit dieser Installation. Deshalb wurde nichts gespeichert. Wenn du die App auf GitHub installiert hast, öffne deine Connector-Einstellungen in Tale und installiere sie von dort erneut auf GitHub.',
    },
    install_requested: {
      title: 'Die Installation wartet auf Freigabe',
      detail:
        'GitHub hat einen Inhaber der GitHub-Organisation gebeten, diese Installation freizugeben. Deshalb hat sich in Tale noch nichts geändert. Sobald sie freigegeben ist, wähle in deinen Connector-Einstellungen erneut „Auf GitHub installieren“, und Tale übernimmt die Installation.',
    },
    signed_out: {
      title: 'Melde dich bei Tale an, um fortzufahren',
      detail:
        'GitHub hat dich zurückgeschickt, aber dieser Browser ist nicht bei Tale angemeldet. Deshalb wurde nichts gespeichert. Melde dich an, öffne deine Connector-Einstellungen und installiere die App dort erneut auf GitHub.',
    },
  },
  fr: {
    invalid_details: {
      title: 'Ces informations ne permettent pas d’enregistrer une GitHub App',
      detail:
        'Le nom de l’app doit compter de 1 à 34 caractères et, si tu indiques une organisation GitHub, il faut son identifiant. Rien n’a été envoyé à GitHub. Vérifie les informations dans les paramètres de tes connecteurs, puis enregistre à nouveau.',
    },
    cannot_register: {
      title: 'Cette GitHub App ne peut pas être enregistrée',
      detail:
        'Tale ne peut pas créer ces identifiants. Rien n’a donc été envoyé à GitHub. Enregistre à nouveau depuis les paramètres de tes connecteurs.',
    },
    cross_site: {
      title: 'Lance cette action depuis Tale',
      detail:
        'Elle a été ouverte depuis un lien sur un autre site web. Tu n’as donc pas été redirigé vers GitHub et rien n’a été enregistré. Ouvre les paramètres de tes connecteurs et recommence à cet endroit.',
    },
    not_configured: {
      title: 'L’adresse publique de Tale n’est pas définie',
      detail:
        'GitHub te renvoie vers l’adresse publique de Tale, et cette instance n’en a pas. Rien n’a donc été envoyé à GitHub. Un opérateur la définit avec SITE_URL.',
    },
    register_expired: {
      title: 'Ce lien d’enregistrement a expiré',
      detail:
        'Un enregistrement ne vaut qu’une fois, pour la personne qui l’a lancé, et pendant 15 minutes. Rien n’a donc été enregistré dans Tale. Enregistre à nouveau depuis les paramètres de tes connecteurs.',
    },
    install_expired: {
      title: 'Ce lien d’installation a expiré',
      detail:
        'Une installation ne vaut qu’une fois, pour la personne qui l’a lancée, et pendant 15 minutes. Rien n’a donc été enregistré dans Tale. Ouvre les paramètres de tes connecteurs et installe à nouveau l’app sur GitHub.',
    },
    forbidden: {
      title: 'Seul un admin peut terminer cette action',
      detail:
        'Ton accès à cette organisation a changé pendant que tu étais sur GitHub. Rien n’a donc été enregistré dans Tale. Seuls les Propriétaires et Admins de l’organisation peuvent enregistrer ou installer une GitHub App.',
    },
    github_refused: {
      title: 'GitHub n’a pas remis la nouvelle app',
      detail:
        'Sans elle, Tale ne peut rien signer. Rien n’a donc été enregistré. Enregistre à nouveau depuis les paramètres de tes connecteurs.',
    },
    register_storage_failed: {
      title: 'L’app n’a pas pu être enregistrée dans Tale',
      detail:
        'GitHub a créé l’app, mais Tale n’a pas pu la stocker et ne peut donc pas l’utiliser. Enregistre à nouveau depuis les paramètres de tes connecteurs.',
    },
    credential_missing: {
      title: 'Ces identifiants ne peuvent pas être installés',
      detail:
        'Ils ont été supprimés ou n’appartiennent pas à une GitHub App. Rien n’a donc changé. Vérifie les paramètres de tes connecteurs.',
    },
    installation_missing: {
      title: 'GitHub n’a indiqué aucune installation',
      detail:
        'GitHub t’a renvoyé sans installation. Rien n’a donc été enregistré. Ouvre les paramètres de tes connecteurs et installe à nouveau l’app sur GitHub.',
    },
    installation_wrong_app: {
      title: 'Cette installation appartient à une autre app',
      detail:
        'Selon GitHub, cette installation n’appartient pas à l’app de ces identifiants. Rien n’a donc été enregistré. Ouvre les paramètres de tes connecteurs et installe la bonne app.',
    },
    installation_not_found: {
      title: 'GitHub ne connaît pas cette installation',
      detail:
        'Elle a peut-être été supprimée sur GitHub. Rien n’a donc été enregistré. Ouvre les paramètres de tes connecteurs et installe à nouveau l’app sur GitHub.',
    },
    installation_suspended: {
      title: 'Cette installation est suspendue',
      detail:
        'Elle est suspendue sur GitHub, donc Tale ne peut pas l’utiliser et rien n’a été enregistré. Réactive-la parmi les GitHub Apps installées de son compte sur GitHub, puis installe à nouveau l’app depuis les paramètres de tes connecteurs.',
    },
    installation_refused: {
      title: 'GitHub n’a pas confirmé cette installation',
      detail:
        'Tale lit chaque installation avec la clé propre de l’app avant de l’enregistrer, et GitHub n’a pas répondu à cette lecture. Rien n’a donc été enregistré. Réessaie dans quelques minutes depuis les paramètres de tes connecteurs.',
    },
    github_unreachable: {
      title: 'GitHub n’a pas pu être joint',
      detail:
        'Rien n’a été enregistré. Réessaie dans quelques minutes depuis les paramètres de tes connecteurs.',
    },
    installation_unknown: {
      title: 'Tale n’a aucun identifiant pour cette installation',
      detail:
        'Aucune des organisations que tu administres dans Tale n’a d’identifiants de GitHub App avec cette installation. Rien n’a donc été enregistré. Si tu as installé l’app depuis GitHub, ouvre les paramètres de tes connecteurs dans Tale et installe-la à nouveau sur GitHub depuis cet endroit.',
    },
    install_requested: {
      title: 'L’installation attend une approbation',
      detail:
        'GitHub a demandé à un propriétaire de l’organisation GitHub d’approuver cette installation. Rien n’a donc encore changé dans Tale. Une fois qu’elle est approuvée, sélectionne à nouveau « Installer sur GitHub » dans les paramètres de tes connecteurs, et Tale prend en compte l’installation.',
    },
    signed_out: {
      title: 'Connecte-toi à Tale pour terminer',
      detail:
        'GitHub t’a renvoyé, mais ce navigateur n’est pas connecté à Tale. Rien n’a donc été enregistré. Connecte-toi, ouvre les paramètres de tes connecteurs et installe à nouveau l’app sur GitHub.',
    },
  },
};

interface Phrases {
  readonly back: string;
  readonly githubSaid: string;
  readonly reason: string;
  /** GitHub may hold an app Tale never received. */
  readonly orphanUnknown: string;
  /** GitHub may hold an app, which Tale holds only if this return replays
   * a registration that completed. */
  readonly orphanUnmatched: string;
  /** GitHub holds the app named `{name}`, which Tale did not store. */
  readonly orphanKnown: string;
  readonly orphanLink: string;
  readonly handoffTitle: string;
  /** `{name}` is the app's name. */
  readonly handoffDetail: string;
}

const PHRASES: Record<SupportedLocale, Phrases> = {
  en: {
    back: 'Back to connector settings',
    githubSaid: 'GitHub said:',
    reason: 'Reason:',
    orphanUnknown:
      'GitHub may have created the app already. Tale does not hold it, so delete it on GitHub under Developer settings › GitHub Apps in your account’s or organization’s settings.',
    orphanUnmatched:
      'GitHub may have created the app already. If your connector settings show a GitHub App credential for it, Tale holds the app and you can keep it. If not, delete it on GitHub under Developer settings › GitHub Apps in your account’s or organization’s settings.',
    orphanKnown:
      'GitHub created the app “{name}”, but Tale does not hold it. Delete it on GitHub.',
    orphanLink: 'Open the app’s settings on GitHub',
    handoffTitle: 'Continue to GitHub',
    handoffDetail:
      'Tale is sending you to GitHub to register the app “{name}”. Create it there, then choose the repositories it may reach.',
  },
  de: {
    back: 'Zurück zu den Connector-Einstellungen',
    githubSaid: 'Antwort von GitHub:',
    reason: 'Grund:',
    orphanUnknown:
      'GitHub hat die App vielleicht schon angelegt. Tale hat sie nicht. Lösche sie deshalb auf GitHub unter Developer settings › GitHub Apps in den Einstellungen deines Kontos oder deiner Organisation.',
    orphanUnmatched:
      'GitHub hat die App vielleicht schon angelegt. Zeigen deine Connector-Einstellungen Zugangsdaten für diese App, hat Tale sie, und du kannst sie behalten. Wenn nicht, lösche sie auf GitHub unter Developer settings › GitHub Apps in den Einstellungen deines Kontos oder deiner Organisation.',
    orphanKnown:
      'GitHub hat die App „{name}“ angelegt, aber Tale hat sie nicht. Lösche sie auf GitHub.',
    orphanLink: 'Einstellungen der App auf GitHub öffnen',
    handoffTitle: 'Weiter zu GitHub',
    handoffDetail:
      'Tale leitet dich zu GitHub weiter, um die App „{name}“ zu registrieren. Lege sie dort an und wähle danach die Repositorys, die sie erreichen darf.',
  },
  fr: {
    back: 'Retour aux paramètres des connecteurs',
    githubSaid: 'Réponse de GitHub :',
    reason: 'Motif :',
    orphanUnknown:
      'GitHub a peut-être déjà créé l’app. Tale ne la détient pas : supprime-la sur GitHub sous Developer settings › GitHub Apps, dans les paramètres de ton compte ou de ton organisation.',
    orphanUnmatched:
      'GitHub a peut-être déjà créé l’app. Si les paramètres de tes connecteurs affichent des identifiants de GitHub App pour elle, Tale la détient et tu peux la garder. Sinon, supprime-la sur GitHub sous Developer settings › GitHub Apps, dans les paramètres de ton compte ou de ton organisation.',
    orphanKnown:
      'GitHub a créé l’app « {name} », mais Tale ne la détient pas. Supprime-la sur GitHub.',
    orphanLink: 'Ouvrir les paramètres de l’app sur GitHub',
    handoffTitle: 'Continuer vers GitHub',
    handoffDetail:
      'Tale t’envoie sur GitHub pour enregistrer l’app « {name} ». Crée-la là-bas, puis choisis les dépôts auxquels elle peut accéder.',
  },
};

function pageLocale(acceptLanguage: string): SupportedLocale {
  const preferred = parseAcceptLanguage(acceptLanguage).find((candidate) =>
    SUPPORTED_LOCALES.some(
      (supported) => candidate.toLowerCase().split('-')[0] === supported,
    ),
  );
  return baseLocaleOf(preferred?.toLowerCase());
}

function escapeHtml(value: string): string {
  return he.escape(value);
}

/** An app GitHub may hold that Tale does not: a registration that failed
 * after GitHub created it. Known once GitHub traded the code. `unmatched`
 * is a return no round trip matches — forged, expired, another member's,
 * or a replay of one that completed and stored its app: the claimed state
 * is gone, so Tale cannot tell, and the note says how to. */
export type OrphanedApp =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'unmatched' }
  | {
      readonly kind: 'known';
      readonly name: string;
      readonly settingsUrl: string;
    };

export interface GithubAppPageOptions {
  /** The connector settings to go back to; null links the dashboard. */
  readonly backUrl: string | null;
  readonly acceptLanguage?: string;
  /** Overrides the kind's status (a credential refusal keeps its own). */
  readonly status?: number;
  /** GitHub's own refusal text, quoted. */
  readonly githubMessage?: string;
  /** Tale's own reason, quoted (a credential refusal's message). */
  readonly reason?: string;
  readonly orphan?: OrphanedApp;
}

const PAGE_CSP =
  "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function htmlResponse(
  html: string,
  status: number,
  locale: SupportedLocale,
  csp: string,
): Response {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Language': locale,
      Vary: 'Accept-Language, Cookie',
      // A return's URL carries GitHub's code or state; caching the page
      // anywhere would keep them.
      'Cache-Control': 'no-store',
      'Content-Security-Policy': csp,
      // No Referrer-Policy header: the deployment's security headers
      // (`backendSecureHeaders`) set `strict-origin-when-cross-origin` on
      // every answer, over any a route sets. The page's own meta tag is the
      // policy its links and form follow (`pageDocument`).
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** A page's document. Its `<meta name="referrer" content="no-referrer">`
 * is the policy its links and its form follow: the URL a return lands on
 * carries GitHub's code or a state token, and no link on the page — to
 * GitHub, or back to Tale — hands it on. */
function pageDocument(
  locale: SupportedLocale,
  title: string,
  body: string,
  extraHead = '',
): string {
  return `<!DOCTYPE html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="referrer" content="no-referrer">${extraHead}
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
${body}
    </main>
  </body>
</html>
`;
}

/** The outcome page of a round trip that saved nothing (or, for
 * `install_requested`, nothing yet). */
export function renderGithubAppPage(
  kind: GithubAppPageKind,
  options: GithubAppPageOptions,
): Response {
  const locale = pageLocale(options.acceptLanguage ?? '');
  const copy = COPY[locale][kind];
  const phrases = PHRASES[locale];
  const lines = [`      <p>${escapeHtml(copy.detail)}</p>`];
  if (options.reason !== undefined) {
    lines.push(
      `      <p>${escapeHtml(phrases.reason)} ${escapeHtml(options.reason)}</p>`,
    );
  }
  if (options.githubMessage !== undefined) {
    lines.push(
      `      <p>${escapeHtml(phrases.githubSaid)} <q>${escapeHtml(options.githubMessage)}</q></p>`,
    );
  }
  const orphan = options.orphan;
  if (orphan?.kind === 'unknown') {
    lines.push(`      <p>${escapeHtml(phrases.orphanUnknown)}</p>`);
  } else if (orphan?.kind === 'unmatched') {
    lines.push(`      <p>${escapeHtml(phrases.orphanUnmatched)}</p>`);
  } else if (orphan?.kind === 'known') {
    // A replacer function: the name is GitHub's, and a `$&` in it is text.
    const { name } = orphan;
    lines.push(
      `      <p>${escapeHtml(phrases.orphanKnown.replace('{name}', () => name))}</p>`,
      `      <p><a href="${escapeHtml(orphan.settingsUrl)}">${escapeHtml(phrases.orphanLink)}</a></p>`,
    );
  }
  lines.push(
    `      <p><a href="${escapeHtml(options.backUrl ?? `${basePath()}/dashboard`)}">${escapeHtml(options.backUrl === null ? 'Tale' : phrases.back)}</a></p>`,
  );
  return htmlResponse(
    pageDocument(locale, copy.title, lines.join('\n')),
    options.status ?? STATUS[kind],
    locale,
    PAGE_CSP,
  );
}

/** The hand-off's one script: submit the manifest form on load. A browser
 * without scripts shows the form's own button instead. */
const HANDOFF_SCRIPT =
  "document.getElementById('github-app-manifest').submit();";
const HANDOFF_SCRIPT_HASH = `sha256-${createHash('sha256').update(HANDOFF_SCRIPT).digest('base64')}`;

/** The hand-off page's own policy: no source but its one script, and a form
 * that may post to GitHub alone. */
export const GITHUB_APP_HANDOFF_CSP = `default-src 'none'; form-action https://github.com; script-src '${HANDOFF_SCRIPT_HASH}'; base-uri 'none'; frame-ancestors 'none'`;

/**
 * The page that posts the app's manifest to GitHub (GitHub's manifest flow
 * takes it only as a form field of a browser POST). It submits itself; the
 * visible button does the same where scripts do not run.
 */
export function renderGithubAppHandoffPage(args: {
  readonly actionUrl: string;
  readonly manifest: unknown;
  readonly appName: string;
  readonly acceptLanguage?: string;
}): Response {
  const locale = pageLocale(args.acceptLanguage ?? '');
  const phrases = PHRASES[locale];
  const body = `      <p>${escapeHtml(phrases.handoffDetail.replace('{name}', () => args.appName))}</p>
      <form id="github-app-manifest" method="post" action="${escapeHtml(args.actionUrl)}">
        <input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(args.manifest))}">
        <button type="submit">${escapeHtml(phrases.handoffTitle)}</button>
      </form>
      <script>${HANDOFF_SCRIPT}</script>`;
  return htmlResponse(
    pageDocument(locale, phrases.handoffTitle, body),
    200,
    locale,
    GITHUB_APP_HANDOFF_CSP,
  );
}
