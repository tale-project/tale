/**
 * Server-side rendering of notification text for outbound delivery (email).
 *
 * The in-app bell renders notification keys client-side; the email sink has
 * no i18n runtime, so this module mirrors the small set of `inbox` strings it
 * needs and interpolates the simple `{name}` placeholders the catalog uses.
 * `INBOX_I18N` is kept honest by `notification_messages.test.ts`, which
 * deep-equals it against `services/platform/messages/{en,de,fr}/inbox.yml` —
 * editing an actionable inbox string there without updating it here fails
 * CI.
 */

import { interpolateTemplate } from '../../../lib/shared/utils/interpolate';

export const SUPPORTED_NOTIFICATION_LOCALES = ['en', 'de', 'fr'] as const;
export type NotificationLocale =
  (typeof SUPPORTED_NOTIFICATION_LOCALES)[number];

function isSupportedLocale(value: string): value is NotificationLocale {
  return (SUPPORTED_NOTIFICATION_LOCALES as readonly string[]).includes(value);
}

type LocaleStrings = Record<string, string>;

/**
 * Actionable inbox keys mirrored for server-side email rendering. Kept honest by
 * `notification_messages.test.ts` against the `inbox` namespace subset in
 * messages/{en,de,fr}/inbox.yml.
 *
 * EVERY key an actionable-notification path can emit MUST be listed here (and so
 * mirrored in `INBOX_I18N`) — otherwise the email falls back to the raw key.
 * `email_key_coverage.test.ts` enforces that: it scans both the code emitters
 * and the builtin automations for actionable `titleKey`/`bodyKey`s and fails if
 * any is unmirrored. Sources beyond the individual code paths:
 *   - `taskReviewReminder*` / `taskReviewEscalated*` — `remind-reviewers` automation
 *   - `humanInputEscalated*` — `remind-reviewers` automation
 *   - `agentQuestionAsked*` — `collab/notify_agent_asks.ts` (the `ask_human` fan-out)
 *   - `taskSlaEscalated*` / `taskDueSoon*` / `taskStartReached*` —
 *     `tasks/enforce_date_notifications` cron
 *   - `conversationTeamAssigned*` — `collab/notify.ts` team hand-off
 *   - `agentRunFailed*` — `collab/service.ts` `notifyAgentRunFailed` (the body
 *     key is picked by the run's failure class)
 */
export const ACTIONABLE_INBOX_KEYS = [
  'taskAssigned',
  'taskAssignedBody',
  'taskAssignedByBody',
  'mention',
  'mentionBody',
  'mentionByBody',
  'taskReviewRequested',
  'taskReviewRequestedBody',
  'taskReviewRequestedBodyNoAgent',
  'taskReviewRequestedByBody',
  'taskReviewRequestedBodyHuman',
  'documentReviewRequested',
  'documentReviewRequestedBody',
  'documentReviewRequestedBodyNoActor',
  'taskReviewReminder',
  'taskReviewReminderBody',
  'taskReviewEscalated',
  'taskReviewEscalatedBody',
  'agentEscalation',
  'agentEscalationBody',
  'agentQuestionAsked',
  'agentQuestionAskedBody',
  'agentQuestionAskedNoTaskBody',
  'humanInputEscalated',
  'humanInputEscalatedBody',
  'taskSlaEscalated',
  'taskSlaEscalatedBody',
  'taskDueSoon',
  'taskDueSoonBody',
  'taskStartReached',
  'taskStartReachedBody',
  'conversationInboundMessage',
  'conversationInboundMessageBody',
  'conversationAssigned',
  'conversationAssignedBody',
  'conversationAssignedByBody',
  'conversationTeamAssigned',
  'conversationTeamAssignedBody',
  'conversationTeamAssignedByBody',
  'cloudSyncFailed',
  'cloudSyncFailedBody',
  'cloudSyncNeedsReauth',
  'cloudSyncNeedsReauthBody',
  'usageCreditsRequested',
  'usageCreditsRequestedBody',
  'automationTriggerPaused',
  'automationTriggerPausedBody',
  'agentRunFailed',
  'agentRunFailedBody',
  'agentRunFailedBudgetBody',
  'agentRunFailedSetupBody',
  'email.cta',
  'email.footer',
] as const;

export const INBOX_I18N: Record<NotificationLocale, LocaleStrings> = {
  en: {
    taskAssigned: 'Task assigned to you',
    taskAssignedBody: 'You were assigned "{title}".',
    taskAssignedByBody: '{actor} assigned you to "{title}".',
    mention: 'You were mentioned',
    mentionBody: 'You were mentioned on "{title}".',
    mentionByBody: '{actor} mentioned you on "{title}".',
    taskReviewRequested: 'Review requested',
    taskReviewRequestedBody:
      '{agentSlug} finished "{taskTitle}" — set it to Done to approve, or comment to send it back.',
    taskReviewRequestedBodyNoAgent:
      'Agent work on "{taskTitle}" is ready for review — set the task to Done to approve, or comment to send it back.',
    taskReviewRequestedByBody:
      '{actor} asked you to review "{taskTitle}" — set it to Done to approve, or comment to send it back.',
    taskReviewRequestedBodyHuman:
      '"{taskTitle}" is ready for your review — set it to Done to approve, or comment to send it back.',
    documentReviewRequested: 'Document review requested',
    documentReviewRequestedBody:
      '{requestedByName} sent "{documentTitle}" (v{version}) for your review.',
    documentReviewRequestedBodyNoActor:
      '"{documentTitle}" (v{version}) is waiting for your review.',
    taskReviewReminder: 'Review reminder',
    taskReviewReminderBody:
      'Agent work on "{title}" is still waiting for your review.',
    taskReviewEscalated: 'Review overdue',
    taskReviewEscalatedBody:
      'A review on "{title}" has been waiting for over a day.',
    agentEscalation: 'Agent escalation',
    agentEscalationBody: '{agent} escalated: {reason}',
    agentQuestionAsked: 'Agent needs your answer',
    agentQuestionAskedBody:
      '{name} paused with a question on "{title}": {question}',
    agentQuestionAskedNoTaskBody: '{name} paused with a question: {question}',
    humanInputEscalated: 'Automation waiting on input',
    humanInputEscalatedBody:
      'An automation has been waiting on human input for {ageHours} hours.',
    taskSlaEscalated: 'Overdue task escalated',
    taskSlaEscalatedBody:
      '"{title}" is significantly overdue and needs attention.',
    taskDueSoon: 'Due soon',
    taskDueSoonBody: '"{title}" is due soon.',
    taskStartReached: 'Start date reached',
    taskStartReachedBody: '"{title}" starts today.',
    conversationInboundMessage: 'New conversation message',
    conversationInboundMessageBody:
      'From {sender}: "{subject}" — open your Inbox to reply.',
    conversationAssigned: 'Conversation assigned to you',
    conversationAssignedBody:
      'You were assigned the conversation "{subject}" — open your Inbox to reply.',
    conversationAssignedByBody:
      '{actor} assigned you the conversation "{subject}" — open your Inbox to reply.',
    conversationTeamAssigned: 'Conversation queued to your team',
    conversationTeamAssignedBody:
      'The conversation "{subject}" was queued to your team — open your Inbox to reply.',
    conversationTeamAssignedByBody:
      '{actor} queued the conversation "{subject}" to your team — open your Inbox to reply.',
    cloudSyncFailed: 'Cloud sync failing',
    cloudSyncFailedBody:
      'Syncing "{itemName}" from {provider} has been failing for over an hour ({reason}). Tale keeps retrying every 15 minutes.',
    cloudSyncNeedsReauth: 'Cloud sync needs reconnecting',
    cloudSyncNeedsReauthBody:
      'Tale can no longer access {provider} with your account, so "{itemName}" stopped syncing. Reconnect {provider} from Documents to resume.',
    usageCreditsRequested: 'Usage credits requested',
    usageCreditsRequestedBody:
      '{name} reached a usage limit and asked for more credits.',
    automationTriggerPaused: 'Schedule paused',
    automationTriggerPausedBody:
      '"{name}" failed {failures} runs in a row ({code}), so its schedule is paused. Fix the automation, then turn its trigger back on.',
    agentRunFailed: 'Agent run failed',
    agentRunFailedBody:
      'The agent couldn\'t finish "{title}". Open the task to see why and start it again.',
    agentRunFailedBudgetBody:
      'A usage limit stopped the agent on "{title}". Once an Admin raises it, start the agent again.',
    agentRunFailedSetupBody:
      'The agent on "{title}" is missing something it needs. An Editor or Admin can fix it on the project\'s Agents tab.',
    'email.cta': 'Open in Tale',
    'email.footer':
      'You received this email because you have notifications enabled in Tale.',
  },
  de: {
    taskAssigned: 'Aufgabe dir zugewiesen',
    taskAssignedBody: 'Dir wurde "{title}" zugewiesen.',
    taskAssignedByBody: '{actor} hat dir "{title}" zugewiesen.',
    mention: 'Du wurdest erwähnt',
    mentionBody: 'Du wurdest bei "{title}" erwähnt.',
    mentionByBody: '{actor} hat dich in "{title}" erwähnt.',
    taskReviewRequested: 'Review angefragt',
    taskReviewRequestedBody:
      '{agentSlug} hat "{taskTitle}" abgeschlossen — stelle die Aufgabe zum Freigeben auf "Erledigt" oder schicke sie mit einem Kommentar zurück.',
    taskReviewRequestedBodyNoAgent:
      'Agenten-Arbeit an "{taskTitle}" ist bereit zur Prüfung — stelle die Aufgabe zum Freigeben auf "Erledigt" oder schicke sie mit einem Kommentar zurück.',
    taskReviewRequestedByBody:
      '{actor} bittet dich um ein Review von "{taskTitle}" — stelle die Aufgabe zum Freigeben auf "Erledigt" oder schicke sie mit einem Kommentar zurück.',
    taskReviewRequestedBodyHuman:
      '"{taskTitle}" wartet auf dein Review — stelle die Aufgabe zum Freigeben auf "Erledigt" oder schicke sie mit einem Kommentar zurück.',
    documentReviewRequested: 'Dokument-Review angefragt',
    documentReviewRequestedBody:
      '{requestedByName} hat dir "{documentTitle}" (v{version}) zum Review geschickt.',
    documentReviewRequestedBodyNoActor:
      '"{documentTitle}" (v{version}) wartet auf dein Review.',
    taskReviewReminder: 'Review-Erinnerung',
    taskReviewReminderBody:
      'Agenten-Arbeit an "{title}" wartet weiterhin auf dein Review.',
    taskReviewEscalated: 'Review überfällig',
    taskReviewEscalatedBody:
      'Ein Review zu "{title}" wartet seit über einem Tag.',
    agentEscalation: 'Agenten-Eskalation',
    agentEscalationBody: '{agent} hat eskaliert: {reason}',
    agentQuestionAsked: 'Agent braucht deine Antwort',
    agentQuestionAskedBody:
      '{name} hat eine Frage zu "{title}" und wartet auf dich: {question}',
    agentQuestionAskedNoTaskBody:
      '{name} hat eine Frage und wartet auf dich: {question}',
    humanInputEscalated: 'Automatisierung wartet auf Eingabe',
    humanInputEscalatedBody:
      'Eine Automatisierung wartet seit {ageHours} Stunden auf menschliche Eingabe.',
    taskSlaEscalated: 'Überfällige Aufgabe eskaliert',
    taskSlaEscalatedBody:
      '"{title}" ist deutlich überfällig und braucht Aufmerksamkeit.',
    taskDueSoon: 'Bald fällig',
    taskDueSoonBody: '"{title}" ist bald fällig.',
    taskStartReached: 'Startdatum erreicht',
    taskStartReachedBody: '"{title}" beginnt heute.',
    conversationInboundMessage: 'Neue Konversationsnachricht',
    conversationInboundMessageBody:
      'Von {sender}: "{subject}" — öffne deine Inbox, um zu antworten.',
    conversationAssigned: 'Konversation dir zugewiesen',
    conversationAssignedBody:
      'Dir wurde die Konversation "{subject}" zugewiesen — öffne deine Inbox, um zu antworten.',
    conversationAssignedByBody:
      '{actor} hat dir die Konversation "{subject}" zugewiesen — öffne deine Inbox, um zu antworten.',
    conversationTeamAssigned: 'Konversation deinem Team zugewiesen',
    conversationTeamAssignedBody:
      'Die Konversation "{subject}" wurde deinem Team zugewiesen — öffne deine Inbox, um zu antworten.',
    conversationTeamAssignedByBody:
      '{actor} hat die Konversation "{subject}" deinem Team zugewiesen — öffne deine Inbox, um zu antworten.',
    cloudSyncFailed: 'Cloud-Synchronisierung schlägt fehl',
    cloudSyncFailedBody:
      'Die Synchronisierung von "{itemName}" aus {provider} schlägt seit über einer Stunde fehl ({reason}). Tale versucht es weiterhin alle 15 Minuten.',
    cloudSyncNeedsReauth: 'Cloud-Synchronisierung muss neu verbunden werden',
    cloudSyncNeedsReauthBody:
      'Tale hat mit deinem Konto keinen Zugriff mehr auf {provider}, deshalb wird "{itemName}" nicht mehr synchronisiert. Verbinde {provider} unter Dokumente erneut, um fortzufahren.',
    usageCreditsRequested: 'Nutzungskontingent angefragt',
    usageCreditsRequestedBody:
      '{name} hat ein Nutzungslimit erreicht und um mehr Kontingent gebeten.',
    automationTriggerPaused: 'Zeitplan pausiert',
    automationTriggerPausedBody:
      '"{name}" ist {failures}-mal in Folge fehlgeschlagen ({code}), deshalb ist der Zeitplan pausiert. Behebe den Fehler in der Automatisierung und schalte ihren Trigger dann wieder ein.',
    agentRunFailed: 'Agenten-Lauf fehlgeschlagen',
    agentRunFailedBody:
      'Der Agent konnte "{title}" nicht fertigstellen. In der Aufgabe siehst du, warum, und kannst ihn erneut starten.',
    agentRunFailedBudgetBody:
      'Ein Nutzungslimit hat den Agenten bei "{title}" gestoppt. Sobald ein Admin es anhebt, starte den Agenten erneut.',
    agentRunFailedSetupBody:
      'Dem Agenten für "{title}" fehlt etwas, das er braucht. Ein Redakteur oder Admin kann das im Tab "Agenten" des Projekts beheben.',
    'email.cta': 'In Tale öffnen',
    'email.footer':
      'Du erhältst diese E-Mail, weil du Benachrichtigungen in Tale aktiviert hast.',
  },
  fr: {
    taskAssigned: 'Tâche assignée',
    taskAssignedBody: "«\u00a0{title}\u00a0» t'a été assignée.",
    taskAssignedByBody: "{actor} t'a assigné «\u00a0{title}\u00a0».",
    mention: 'Tu as été mentionné',
    mentionBody: 'Tu as été mentionné dans «\u00a0{title}\u00a0».',
    mentionByBody: "{actor} t'a mentionné dans «\u00a0{title}\u00a0».",
    taskReviewRequested: 'Revue demandée',
    taskReviewRequestedBody:
      '{agentSlug} a terminé « {taskTitle} » — passe la tâche en « Terminé » pour approuver, ou renvoie-la avec un commentaire.',
    taskReviewRequestedBodyNoAgent:
      "Le travail de l'agent sur « {taskTitle} » est prêt pour la revue — passe la tâche en « Terminé » pour approuver, ou renvoie-la avec un commentaire.",
    taskReviewRequestedByBody:
      '{actor} te demande une revue de « {taskTitle} » — passe la tâche en « Terminé » pour approuver, ou renvoie-la avec un commentaire.',
    taskReviewRequestedBodyHuman:
      '« {taskTitle} » attend ta revue — passe la tâche en « Terminé » pour approuver, ou renvoie-la avec un commentaire.',
    documentReviewRequested: 'Revue de document demandée',
    documentReviewRequestedBody:
      '{requestedByName} t’a envoyé « {documentTitle} » (v{version}) en revue.',
    documentReviewRequestedBodyNoActor:
      '« {documentTitle} » (v{version}) attend ta revue.',
    taskReviewReminder: 'Rappel de revue',
    taskReviewReminderBody:
      "Le travail de l'agent sur « {title} » attend toujours votre revue.",
    taskReviewEscalated: 'Revue en retard',
    taskReviewEscalatedBody:
      "Une revue sur « {title} » attend depuis plus d'un jour.",
    agentEscalation: "Escalade d'agent",
    agentEscalationBody: '{agent} a escaladé : {reason}',
    agentQuestionAsked: "L'agent attend ta réponse",
    agentQuestionAskedBody:
      '{name} attend ta réponse sur « {title} » : {question}',
    agentQuestionAskedNoTaskBody: '{name} attend ta réponse : {question}',
    humanInputEscalated: "Automatisation en attente d'une saisie",
    humanInputEscalatedBody:
      'Une automatisation attend une saisie humaine depuis {ageHours} heures.',
    taskSlaEscalated: 'Tâche en retard escaladée',
    taskSlaEscalatedBody:
      '« {title} » est nettement en retard et demande votre attention.',
    taskDueSoon: 'Échéance proche',
    taskDueSoonBody: '« {title} » arrive bientôt à échéance.',
    taskStartReached: 'Date de début atteinte',
    taskStartReachedBody: "« {title} » commence aujourd'hui.",
    conversationInboundMessage: 'Nouveau message de conversation',
    conversationInboundMessageBody:
      'De {sender} : « {subject} » — ouvre ta boîte de réception pour répondre.',
    conversationAssigned: 'Conversation assignée',
    conversationAssignedBody:
      "La conversation « {subject} » t'a été assignée — ouvre ta boîte de réception pour répondre.",
    conversationAssignedByBody:
      "{actor} t'a assigné la conversation « {subject} » — ouvre ta boîte de réception pour répondre.",
    conversationTeamAssigned: 'Conversation assignée à ton équipe',
    conversationTeamAssignedBody:
      'La conversation « {subject} » a été assignée à ton équipe — ouvre ta boîte de réception pour répondre.',
    conversationTeamAssignedByBody:
      '{actor} a assigné la conversation « {subject} » à ton équipe — ouvre ta boîte de réception pour répondre.',
    cloudSyncFailed: 'Synchronisation cloud en échec',
    cloudSyncFailedBody:
      'La synchronisation de « {itemName} » depuis {provider} échoue depuis plus d’une heure ({reason}). Tale réessaie toutes les 15 minutes.',
    cloudSyncNeedsReauth: 'Synchronisation cloud à reconnecter',
    cloudSyncNeedsReauthBody:
      'Tale n’a plus accès à {provider} avec ton compte, donc « {itemName} » n’est plus synchronisé. Reconnecte {provider} depuis Documents pour reprendre.',
    usageCreditsRequested: 'Crédits d’utilisation demandés',
    usageCreditsRequestedBody:
      '{name} a atteint une limite d’utilisation et demande plus de crédits.',
    automationTriggerPaused: 'Planification en pause',
    automationTriggerPausedBody:
      '« {name} » a échoué {failures} fois de suite ({code}), sa planification est donc en pause. Corrige l’automatisation, puis réactive son déclencheur.',
    agentRunFailed: 'Échec de l’exécution de l’agent',
    agentRunFailedBody:
      'L’agent n’a pas pu terminer « {title} ». Ouvre la tâche pour voir pourquoi et le relancer.',
    agentRunFailedBudgetBody:
      'Une limite d’utilisation a arrêté l’agent sur « {title} ». Relance-le dès qu’un admin l’aura relevée.',
    agentRunFailedSetupBody:
      'Il manque quelque chose à l’agent de « {title} ». Un éditeur ou un admin peut corriger cela dans l’onglet Agents du projet.',
    'email.cta': 'Ouvrir dans Tale',
    'email.footer':
      'Tu reçois cet e-mail parce que tu as activé les notifications dans Tale.',
  },
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Resolve an `inbox` template in `locale`, falling back to English. */
function resolveInboxTemplate(locale: string, key: string): string | undefined {
  const loc: NotificationLocale = isSupportedLocale(locale) ? locale : 'en';
  return INBOX_I18N[loc][key] ?? INBOX_I18N.en[key];
}

/**
 * Render an `inbox` namespace string for outbound email. Interpolated values are
 * left as-is (proper nouns / task titles); the template's punctuation is preserved.
 */
export function renderInboxMessage(
  locale: string,
  key: string,
  params?: Record<string, unknown>,
): string {
  const template = resolveInboxTemplate(locale, key);
  if (template === undefined) {
    console.warn(`[notification_messages] no inbox string for key "${key}"`);
    return key;
  }
  return interpolateTemplate(template, params);
}

export function renderActionableEmailContent(
  locale: string,
  args: {
    titleKey: string;
    bodyKey: string;
    params?: Record<string, unknown>;
    deepLink: string;
  },
): { subject: string; text: string; html: string } {
  const subject = renderInboxMessage(locale, args.titleKey, args.params);
  const body = renderInboxMessage(locale, args.bodyKey, args.params);
  const cta = renderInboxMessage(locale, 'email.cta');
  const footer = renderInboxMessage(locale, 'email.footer');

  const text = `${body}\n\n${cta}: ${args.deepLink}\n\n${footer}`;

  // Params enter HTML exactly ONCE, escaped at that single entry point: the
  // template is interpolated one time with the `escapeHtml` transform. The
  // previous shape re-interpolated the ALREADY-interpolated body — the escape
  // pass saw no placeholders left, so external text (task titles, user names,
  // conversation subjects) landed raw in the email HTML, and a hostile param
  // containing a literal `{title}` was even substituted a second time.
  const bodyTemplate = resolveInboxTemplate(locale, args.bodyKey);
  const bodyHtml =
    bodyTemplate === undefined
      ? escapeHtml(args.bodyKey)
      : interpolateTemplate(bodyTemplate, args.params, escapeHtml);
  const ctaHtml = escapeHtml(cta);
  const footerHtml = escapeHtml(footer);
  const linkHtml = escapeHtml(args.deepLink);

  const html =
    `<p>${bodyHtml}</p>` +
    `<p><a href="${linkHtml}">${ctaHtml}</a></p>` +
    `<p style="color:#666;font-size:12px;">${footerHtml}</p>`;

  return { subject, text, html };
}
