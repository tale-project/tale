/**
 * Server-side rendering of notification text for outbound delivery (Slack).
 *
 * The in-app bell renders notification keys client-side via next-intl; the Slack
 * sink has no i18n runtime, so this module mirrors the small set of strings it
 * needs and interpolates the simple `{name}` placeholders the catalog uses.
 *
 * `NOTIFICATIONS_I18N` MIRRORS the `notifications` namespace of
 * `services/platform/messages/{en,de,fr}.json`. It is kept honest by
 * `notification_messages.test.ts`, which deep-equals it against those files —
 * editing a notification string in messages/ without updating it here fails CI.
 * `WORKFLOW_I18N` holds Slack-only workflow-outcome strings that never appear in
 * the bell, so they live solely here.
 *
 * Rendering escapes interpolated values for Slack mrkdwn (so a user-controlled
 * email/error can't inject markup) while leaving the template's own `*bold*`
 * markup intact.
 */

import { interpolateTemplate } from '../../lib/shared/utils/interpolate';

export const SUPPORTED_NOTIFICATION_LOCALES = ['en', 'de', 'fr'] as const;
export type NotificationLocale =
  (typeof SUPPORTED_NOTIFICATION_LOCALES)[number];

function isSupportedLocale(value: string): value is NotificationLocale {
  return (SUPPORTED_NOTIFICATION_LOCALES as readonly string[]).includes(value);
}

type LocaleStrings = Record<string, string>;

export const NOTIFICATIONS_I18N: Record<NotificationLocale, LocaleStrings> = {
  en: {
    title: 'Notifications',
    newNotifications: 'New notifications',
    ariaUnread: 'Unread',
    emptyCaughtUpTitle: "You're all caught up",
    emptyCaughtUpDescription: "We'll let you know when anything new comes in.",
    emptyAllTitle: 'No notifications yet',
    emptyAllDescription:
      'Alerts and system updates will appear here when they arrive.',
    markAsRead: 'Mark as read',
    markAllAsRead: 'Mark all as read',
    expand: 'Expand',
    filterLabel: 'Show',
    filterUnread: 'Unread',
    filterAll: 'All',
    sortLabel: 'Sort',
    sortRecent: 'Most recent',
    sortPriority: 'Priority',
    loadMore: 'Load more',
    loading: 'Loading…',
    creditRequestTitle: 'Usage credits requested',
    creditRequestBody:
      '{name} hit their usage limit and asked for more credits.',
    accountLocked: 'Account temporarily locked: {email}',
    lockoutDetails: '{consecutiveFailures} failed sign-in attempts from {ip}.',
    auditIntegrityFailed: 'Audit log integrity check failed',
    auditIntegrityFailedDetails:
      "We couldn't verify the integrity of this organization's audit log: {reason}. This can indicate tampering — please investigate as soon as possible.",
    auditIntegrityUnverifiable: "Audit log signatures can't be verified",
    auditIntegrityUnverifiableDetails:
      "This organization's audit log checkpoints are signed, but no signing key is configured to verify them: {reason}. Set TALE_AUDIT_SIGNING_KEY to restore tamper-evidence — this is a configuration gap, not detected tampering.",
    websiteScanPaused: 'Website scans paused: {domain}',
    websiteScanPausedDetails:
      "Scans of {domain} were paused after {failures} consecutive attempts couldn't reach this organization's knowledge database. Check the connection under Settings → Data residency, then resume scanning from the Websites page.",
    dsarScheduled: 'Erasure request scheduled',
    dsarScheduledBody:
      'An erasure request was filed for a member of this organization. It runs in {coolingOffHours} hours — open the receipt to review or cancel it.',
    dsarApprovalNeeded: 'Erasure request awaiting your approval',
    dsarApprovalNeededBody:
      "An erasure request needs a second admin's approval before it can run.",
    dsarCancelled: 'Erasure request cancelled',
    dsarCancelledBody:
      "A pending erasure request was cancelled during its cooling-off window, so it won't run.",
    dsarScheduledByBody:
      '{actor} filed an erasure request for {subject}. It runs in {coolingOffHours} hours — open the receipt to review or cancel it.',
    dsarApprovalNeededByBody:
      "{actor} filed an erasure request for {subject}. It needs a second admin's approval before it can run.",
    dsarCancelledByBody:
      "{actor} cancelled the pending erasure request for {subject}, so it won't run.",
    dsarPolicyTightened: 'Data-erasure policy made stricter',
    dsarPolicyTightenedBody:
      "This organization's data-erasure (DSAR) policy was made stricter. It takes effect immediately.",
    dsarPolicyLoosenProposed: 'Data-erasure policy weakening proposed',
    dsarPolicyLoosenProposedBody:
      'A weaker data-erasure (DSAR) policy was proposed. Any admin can cancel it within the 24-hour grace window before it takes effect.',
    dsarPolicyLoosenApplied: 'Data-erasure policy weakened',
    dsarPolicyLoosenAppliedBody:
      'A weaker data-erasure (DSAR) policy took effect after the 24-hour grace window.',
    dsarPolicyLoosenCancelled: 'Pending data-erasure policy change cancelled',
    dsarPolicyLoosenCancelledBody:
      'A pending data-erasure (DSAR) policy change was cancelled before it took effect.',
    agentBudgetWarnTitle: 'Agent approaching its budget',
    agentBudgetWarnBody:
      '{agentSlug} has used {pct}% of its monthly budget ({spent} of {monthly}).',
    agentBudgetExceededTitle: 'Agent budget exceeded — runs paused',
    agentBudgetExceededBody:
      '{agentSlug} reached its monthly budget ({spent} of {monthly}) and has been paused. Runs resume next month or when you raise the limit.',
    agentCircuitTrippedTitle: 'Agent runs paused — safety limit reached',
    agentCircuitTrippedBody:
      '{agentSlug} hit the safety limit of {windowRuns} runs in {windowHours}h on "{taskTitle}". Change the task status to resume automation.',
  },
  de: {
    title: 'Benachrichtigungen',
    newNotifications: 'Neue Benachrichtigungen',
    ariaUnread: 'Ungelesen',
    emptyCaughtUpTitle: 'Alles erledigt',
    emptyCaughtUpDescription: 'Wir melden uns, sobald etwas Neues eintrifft.',
    emptyAllTitle: 'Noch keine Benachrichtigungen',
    emptyAllDescription:
      'Hinweise und System-Updates erscheinen hier, sobald sie eintreffen.',
    markAsRead: 'Als gelesen markieren',
    markAllAsRead: 'Alle als gelesen markieren',
    expand: 'Vergrößern',
    filterLabel: 'Anzeigen',
    filterUnread: 'Ungelesen',
    filterAll: 'Alle',
    sortLabel: 'Sortieren',
    sortRecent: 'Neueste zuerst',
    sortPriority: 'Priorität',
    loadMore: 'Mehr laden',
    loading: 'Lädt…',
    creditRequestTitle: 'Nutzungskontingent angefragt',
    creditRequestBody:
      '{name} hat das Nutzungslimit erreicht und um mehr Kontingent gebeten.',
    accountLocked: 'Konto vorübergehend gesperrt: {email}',
    lockoutDetails:
      '{consecutiveFailures} fehlgeschlagene Anmeldeversuche von {ip}.',
    auditIntegrityFailed: 'Integritätsprüfung des Audit-Logs fehlgeschlagen',
    auditIntegrityFailedDetails:
      'Wir konnten die Integrität des Audit-Logs dieser Organisation nicht bestätigen: {reason}. Das kann auf Manipulation hindeuten — untersuche das so schnell wie möglich.',
    auditIntegrityUnverifiable:
      'Audit-Log-Signaturen können nicht überprüft werden',
    auditIntegrityUnverifiableDetails:
      'Die Audit-Log-Checkpoints dieser Organisation sind signiert, aber es ist kein Signaturschlüssel zur Überprüfung konfiguriert: {reason}. Setze TALE_AUDIT_SIGNING_KEY, um die Manipulationssicherheit wiederherzustellen — das ist eine Konfigurationslücke, keine festgestellte Manipulation.',
    websiteScanPaused: 'Website-Scans pausiert: {domain}',
    websiteScanPausedDetails:
      'Die Scans von {domain} wurden pausiert, nachdem die Wissensdatenbank dieser Organisation {failures} Mal in Folge nicht erreichbar war. Prüfe die Verbindung unter Einstellungen → Datenresidenz und setze die Scans danach auf der Websites-Seite fort.',
    dsarScheduled: 'Löschungsanfrage geplant',
    dsarScheduledBody:
      'Eine Löschungsanfrage wurde für ein Mitglied dieser Organisation eingereicht. Sie wird in {coolingOffHours} Stunden ausgeführt — öffne den Beleg, um sie zu prüfen oder abzubrechen.',
    dsarApprovalNeeded: 'Löschungsanfrage wartet auf deine Freigabe',
    dsarApprovalNeededBody:
      'Eine Löschungsanfrage benötigt die Freigabe eines zweiten Admins, bevor sie ausgeführt werden kann.',
    dsarCancelled: 'Löschungsanfrage abgebrochen',
    dsarCancelledBody:
      'Eine offene Löschungsanfrage wurde während der Karenzzeit abgebrochen und läuft daher nicht.',
    dsarScheduledByBody:
      '{actor} hat eine Löschungsanfrage für {subject} eingereicht. Sie wird in {coolingOffHours} Stunden ausgeführt — öffne den Beleg, um sie zu prüfen oder abzubrechen.',
    dsarApprovalNeededByBody:
      '{actor} hat eine Löschungsanfrage für {subject} eingereicht. Sie benötigt die Freigabe eines zweiten Admins, bevor sie ausgeführt werden kann.',
    dsarCancelledByBody:
      '{actor} hat die offene Löschungsanfrage für {subject} abgebrochen; sie läuft daher nicht.',
    dsarPolicyTightened: 'Löschrichtlinie verschärft',
    dsarPolicyTightenedBody:
      'Die Löschrichtlinie (DSAR) dieser Organisation wurde verschärft. Sie wird sofort wirksam.',
    dsarPolicyLoosenProposed: 'Lockerung der Löschrichtlinie vorgeschlagen',
    dsarPolicyLoosenProposedBody:
      'Eine schwächere Löschrichtlinie (DSAR) wurde vorgeschlagen. Jeder Admin kann sie innerhalb des 24-Stunden-Karenzfensters abbrechen, bevor sie wirksam wird.',
    dsarPolicyLoosenApplied: 'Löschrichtlinie gelockert',
    dsarPolicyLoosenAppliedBody:
      'Eine schwächere Löschrichtlinie (DSAR) wurde nach dem 24-Stunden-Karenzfenster wirksam.',
    dsarPolicyLoosenCancelled:
      'Vorgemerkte Änderung der Löschrichtlinie abgebrochen',
    dsarPolicyLoosenCancelledBody:
      'Eine vorgemerkte Änderung der Löschrichtlinie (DSAR) wurde abgebrochen, bevor sie wirksam wurde.',
    agentBudgetWarnTitle: 'Agent nähert sich seinem Budget',
    agentBudgetWarnBody:
      '{agentSlug} hat {pct} % seines Monatsbudgets verbraucht ({spent} von {monthly}).',
    agentBudgetExceededTitle:
      'Agent-Budget überschritten — Ausführungen pausiert',
    agentBudgetExceededBody:
      '{agentSlug} hat sein Monatsbudget erreicht ({spent} von {monthly}) und wurde pausiert. Ausführungen laufen nächsten Monat weiter oder sobald du das Limit erhöhst.',
    agentCircuitTrippedTitle:
      'Agent-Ausführungen pausiert — Sicherheitslimit erreicht',
    agentCircuitTrippedBody:
      '{agentSlug} hat das Sicherheitslimit von {windowRuns} Ausführungen in {windowHours}h bei "{taskTitle}" erreicht. Ändere den Aufgabenstatus, um die Automatisierung fortzusetzen.',
  },
  fr: {
    title: 'Notifications',
    newNotifications: 'Nouvelles notifications',
    ariaUnread: 'Non lu',
    emptyCaughtUpTitle: 'Tout est à jour',
    emptyCaughtUpDescription:
      "Nous vous préviendrons dès qu'il y aura du nouveau.",
    emptyAllTitle: "Aucune notification pour l'instant",
    emptyAllDescription:
      "Les alertes et mises à jour système apparaîtront ici à mesure qu'elles arriveront.",
    markAsRead: 'Marquer comme lu',
    markAllAsRead: 'Tout marquer comme lu',
    expand: 'Agrandir',
    filterLabel: 'Afficher',
    filterUnread: 'Non lus',
    filterAll: 'Tous',
    sortLabel: 'Trier',
    sortRecent: 'Plus récentes',
    sortPriority: 'Priorité',
    loadMore: 'Charger plus',
    loading: 'Chargement…',
    creditRequestTitle: "Crédits d'utilisation demandés",
    creditRequestBody: '{name} a atteint sa limite et demande plus de crédits.',
    accountLocked: 'Compte temporairement verrouillé : {email}',
    lockoutDetails:
      '{consecutiveFailures} tentatives de connexion échouées depuis {ip}.',
    auditIntegrityFailed: "Échec du contrôle d'intégrité du journal d'audit",
    auditIntegrityFailedDetails:
      "Nous n'avons pas pu vérifier l'intégrité du journal d'audit de cette organisation : {reason}. Cela peut indiquer une altération — examine la situation dès que possible.",
    auditIntegrityUnverifiable:
      "Les signatures du journal d'audit ne peuvent pas être vérifiées",
    auditIntegrityUnverifiableDetails:
      "Les points de contrôle du journal d'audit de cette organisation sont signés, mais aucune clé de signature n'est configurée pour les vérifier : {reason}. Définis TALE_AUDIT_SIGNING_KEY pour rétablir la protection contre l'altération — il s'agit d'une lacune de configuration, pas d'une altération détectée.",
    websiteScanPaused: 'Analyses du site web suspendues : {domain}',
    websiteScanPausedDetails:
      "Les analyses de {domain} ont été suspendues après {failures} tentatives consécutives sans parvenir à joindre la base de connaissances de cette organisation. Vérifie la connexion sous Paramètres → Résidence des données, puis reprends l'analyse depuis la page Sites web.",
    dsarScheduled: "Demande d'effacement planifiée",
    dsarScheduledBody:
      "Une demande d'effacement a été déposée concernant un membre de cette organisation. Elle s'exécute dans {coolingOffHours} heures — ouvre le reçu pour la consulter ou l'annuler.",
    dsarApprovalNeeded: "Demande d'effacement en attente de ton approbation",
    dsarApprovalNeededBody:
      "Une demande d'effacement nécessite l'approbation d'un second admin avant de pouvoir s'exécuter.",
    dsarCancelled: "Demande d'effacement annulée",
    dsarCancelledBody:
      "Une demande d'effacement en attente a été annulée pendant son délai de réflexion ; elle ne s'exécutera pas.",
    dsarScheduledByBody:
      "{actor} a déposé une demande d'effacement concernant {subject}. Elle s'exécute dans {coolingOffHours} heures — ouvre le reçu pour la consulter ou l'annuler.",
    dsarApprovalNeededByBody:
      "{actor} a déposé une demande d'effacement concernant {subject}. Elle nécessite l'approbation d'un second admin avant de pouvoir s'exécuter.",
    dsarCancelledByBody:
      "{actor} a annulé la demande d'effacement en attente concernant {subject} ; elle ne s'exécutera pas.",
    dsarPolicyTightened: "Politique d'effacement renforcée",
    dsarPolicyTightenedBody:
      "La politique d'effacement (DSAR) de cette organisation a été renforcée. Elle prend effet immédiatement.",
    dsarPolicyLoosenProposed:
      "Assouplissement proposé de la politique d'effacement",
    dsarPolicyLoosenProposedBody:
      "Un assouplissement de la politique d'effacement (DSAR) a été proposé. Tout admin peut l'annuler dans le délai de grâce de 24 heures avant qu'il ne prenne effet.",
    dsarPolicyLoosenApplied: "Politique d'effacement assouplie",
    dsarPolicyLoosenAppliedBody:
      "Une politique d'effacement (DSAR) assouplie a pris effet après le délai de grâce de 24 heures.",
    dsarPolicyLoosenCancelled:
      "Modification en attente de la politique d'effacement annulée",
    dsarPolicyLoosenCancelledBody:
      "Une modification en attente de la politique d'effacement (DSAR) a été annulée avant de prendre effet.",
    agentBudgetWarnTitle: "L'agent approche de son budget",
    agentBudgetWarnBody:
      '{agentSlug} a utilisé {pct} % de son budget mensuel ({spent} sur {monthly}).',
    agentBudgetExceededTitle: "Budget de l'agent dépassé — exécutions en pause",
    agentBudgetExceededBody:
      '{agentSlug} a atteint son budget mensuel ({spent} sur {monthly}) et a été mis en pause. Les exécutions reprennent le mois prochain ou lorsque tu augmentes la limite.',
    agentCircuitTrippedTitle:
      "Exécutions de l'agent en pause — limite de sécurité atteinte",
    agentCircuitTrippedBody:
      "{agentSlug} a atteint la limite de sécurité de {windowRuns} exécutions en {windowHours} h sur « {taskTitle} ». Change le statut de la tâche pour reprendre l'automatisation.",
  },
};

/**
 * Actionable inbox keys mirrored for server-side email rendering. Kept honest by
 * `notification_messages.test.ts` against the `inbox` namespace subset in
 * messages/{en,de,fr}.json.
 *
 * EVERY key an actionable-notification path can emit MUST be listed here (and so
 * mirrored in `INBOX_I18N`) — otherwise the email falls back to the raw key.
 * `email_key_coverage.test.ts` enforces that: it scans both the code emitters
 * and the builtin automations for actionable `titleKey`/`bodyKey`s and fails if
 * any is unmirrored. Sources beyond the individual code paths:
 *   - `taskReviewReminder*` / `taskReviewEscalated*` — `remind-reviewers` automation
 *   - `humanInputEscalated*` — `remind-reviewers` automation
 *   - `taskSlaEscalated*` / `taskDueSoon*` / `taskStartReached*` —
 *     `tasks/enforce_date_notifications` cron
 *   - `conversationTeamAssigned*` — `collab/notify.ts` team hand-off
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
    'email.cta': 'Ouvrir dans Tale',
    'email.footer':
      'Tu reçois cet e-mail parce que tu as activé les notifications dans Tale.',
  },
};

/** Slack-only workflow-outcome strings (never shown in the in-app bell). */
const WORKFLOW_I18N: Record<NotificationLocale, LocaleStrings> = {
  en: {
    workflowFailed: 'Workflow *{slug}* failed',
    workflowCompleted: 'Workflow *{slug}* completed',
  },
  de: {
    workflowFailed: 'Workflow *{slug}* fehlgeschlagen',
    workflowCompleted: 'Workflow *{slug}* abgeschlossen',
  },
  fr: {
    workflowFailed: 'Le workflow *{slug}* a échoué',
    workflowCompleted: 'Workflow *{slug}* terminé',
  },
};

/**
 * Escape the three characters Slack reserves in mrkdwn text, so an interpolated
 * user-controlled value cannot inject markup or break rendering. `&` first.
 */
export function escapeSlackText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
  const loc: NotificationLocale = isSupportedLocale(locale) ? locale : 'en';
  const template = INBOX_I18N[loc][key] ?? INBOX_I18N.en[key];
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
    deepLink: string | null;
  },
): { subject: string; text: string; html: string } {
  const subject = renderInboxMessage(locale, args.titleKey, args.params);
  const body = renderInboxMessage(locale, args.bodyKey, args.params);
  const cta = renderInboxMessage(locale, 'email.cta');
  const footer = renderInboxMessage(locale, 'email.footer');

  let text = body;
  if (args.deepLink) {
    text += `\n\n${cta}: ${args.deepLink}`;
  }
  text += `\n\n${footer}`;

  const bodyHtml = interpolateTemplate(
    renderInboxMessage(locale, args.bodyKey, args.params),
    args.params,
    escapeHtml,
  );
  const ctaHtml = escapeHtml(cta);
  const footerHtml = escapeHtml(footer);
  const linkHtml = args.deepLink ? escapeHtml(args.deepLink) : null;

  let html = `<p>${bodyHtml}</p>`;
  if (linkHtml) {
    html += `<p><a href="${linkHtml}">${ctaHtml}</a></p>`;
  }
  html += `<p style="color:#666;font-size:12px;">${footerHtml}</p>`;

  return { subject, text, html };
}

/**
 * Render a notification string in `locale` (falling back to English for an
 * unknown locale or a missing key), interpolating `{name}` placeholders from
 * `params`. Interpolated values are Slack-escaped; the template's own markup is
 * preserved. A missing key returns the key itself and logs — so a gap surfaces
 * in logs instead of silently shipping a raw key to Slack.
 */
export function renderNotificationMessage(
  locale: string,
  key: string,
  params?: Record<string, unknown>,
): string {
  const loc: NotificationLocale = isSupportedLocale(locale) ? locale : 'en';
  const template =
    NOTIFICATIONS_I18N[loc][key] ??
    WORKFLOW_I18N[loc][key] ??
    NOTIFICATIONS_I18N.en[key] ??
    WORKFLOW_I18N.en[key];
  if (template === undefined) {
    console.warn(`[notification_messages] no string for key "${key}"`);
    return key;
  }
  // Interpolated values are Slack-escaped (so a user-controlled email/error can't
  // inject mrkdwn); the template's own markup is preserved. Shares the one
  // interpolator with the rest of the platform.
  return interpolateTemplate(template, params, escapeSlackText);
}
