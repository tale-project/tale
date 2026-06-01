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
    ariaUnread: 'Unread',
    emptyCaughtUpTitle: "You're all caught up",
    emptyCaughtUpDescription: "We'll let you know when anything new comes in.",
    emptyAllTitle: 'No notifications yet',
    emptyAllDescription:
      'Alerts and system updates will appear here when they arrive.',
    markAsRead: 'Mark as read',
    markAllAsRead: 'Mark all as read',
    filterUnread: 'Unread',
    filterAll: 'All',
    loadMore: 'Load more',
    loading: 'Loading…',
    accountLocked: 'Account temporarily locked: {email}',
    lockoutDetails: '{consecutiveFailures} failed sign-in attempts from {ip}.',
    dsarScheduled: 'Erasure request scheduled',
    dsarScheduledBody:
      'An erasure request was filed for a subject in this org. It will execute in {coolingOffHours}h. Open the receipt to review or cancel.',
    dsarApprovalNeeded: 'Erasure request awaiting your approval',
    dsarApprovalNeededBody:
      "An erasure request was filed and requires a second admin's approval before it can run.",
    dsarCancelled: 'Erasure request cancelled',
    dsarCancelledBody:
      'A pending erasure request was cancelled before its cooling-off window elapsed.',
    dsarPolicyTightened: 'DSAR governance policy tightened',
    dsarPolicyTightenedBody:
      'The DSAR governance policy was changed to a stricter setting. Stricter changes apply immediately.',
    dsarPolicyLoosenProposed: 'DSAR governance policy weakening proposed',
    dsarPolicyLoosenProposedBody:
      'A weakening of the DSAR governance policy was proposed. Any admin can cancel before the 24-hour grace window elapses.',
    dsarPolicyLoosenApplied: 'DSAR governance policy weakened',
    dsarPolicyLoosenAppliedBody:
      'The proposed weakening of the DSAR governance policy took effect after the 24-hour grace window.',
    dsarPolicyLoosenCancelled: 'Pending DSAR policy change cancelled',
    dsarPolicyLoosenCancelledBody:
      'The pending weakening of the DSAR governance policy was cancelled before it took effect.',
  },
  de: {
    title: 'Benachrichtigungen',
    ariaUnread: 'Ungelesen',
    emptyCaughtUpTitle: 'Alles erledigt',
    emptyCaughtUpDescription: 'Wir melden uns, sobald etwas Neues eintrifft.',
    emptyAllTitle: 'Noch keine Benachrichtigungen',
    emptyAllDescription:
      'Hinweise und System-Updates erscheinen hier, sobald sie eintreffen.',
    markAsRead: 'Als gelesen markieren',
    markAllAsRead: 'Alle als gelesen markieren',
    filterUnread: 'Ungelesen',
    filterAll: 'Alle',
    loadMore: 'Mehr laden',
    loading: 'Lädt…',
    accountLocked: 'Konto vorübergehend gesperrt: {email}',
    lockoutDetails:
      '{consecutiveFailures} fehlgeschlagene Anmeldeversuche von {ip}.',
    dsarScheduled: 'Löschungsanfrage geplant',
    dsarScheduledBody:
      'Eine Löschungsanfrage wurde für eine Person in dieser Organisation eingereicht. Die Anfrage wird in {coolingOffHours} Stunden ausgeführt. Öffne den Beleg zur Prüfung oder zum Abbruch.',
    dsarApprovalNeeded: 'Löschungsanfrage wartet auf deine Freigabe',
    dsarApprovalNeededBody:
      'Eine Löschungsanfrage wurde eingereicht und benötigt die Freigabe eines zweiten Admins, bevor sie ausgeführt werden kann.',
    dsarCancelled: 'Löschungsanfrage abgebrochen',
    dsarCancelledBody:
      'Eine offene Löschungsanfrage wurde vor Ablauf der Karenzzeit abgebrochen.',
    dsarPolicyTightened: 'DSAR-Governance verschärft',
    dsarPolicyTightenedBody:
      'Die DSAR-Governance-Richtlinie wurde strenger eingestellt. Strengere Änderungen werden sofort wirksam.',
    dsarPolicyLoosenProposed: 'Lockerung der DSAR-Governance vorgeschlagen',
    dsarPolicyLoosenProposedBody:
      'Eine Lockerung der DSAR-Governance wurde vorgeschlagen. Jeder Admin kann sie vor Ablauf des 24-Stunden-Karenzfensters abbrechen.',
    dsarPolicyLoosenApplied: 'DSAR-Governance gelockert',
    dsarPolicyLoosenAppliedBody:
      'Die vorgeschlagene Lockerung der DSAR-Governance wurde nach Ablauf des 24-Stunden-Karenzfensters wirksam.',
    dsarPolicyLoosenCancelled:
      'Vorgemerkte DSAR-Richtlinienänderung abgebrochen',
    dsarPolicyLoosenCancelledBody:
      'Die vorgemerkte Lockerung der DSAR-Governance wurde abgebrochen, bevor sie wirksam wurde.',
  },
  fr: {
    title: 'Notifications',
    ariaUnread: 'Non lu',
    emptyCaughtUpTitle: 'Tout est à jour',
    emptyCaughtUpDescription:
      "Nous vous préviendrons dès qu'il y aura du nouveau.",
    emptyAllTitle: "Aucune notification pour l'instant",
    emptyAllDescription:
      "Les alertes et mises à jour système apparaîtront ici à mesure qu'elles arriveront.",
    markAsRead: 'Marquer comme lu',
    markAllAsRead: 'Tout marquer comme lu',
    filterUnread: 'Non lus',
    filterAll: 'Tous',
    loadMore: 'Charger plus',
    loading: 'Chargement…',
    accountLocked: 'Compte temporairement verrouillé : {email}',
    lockoutDetails:
      '{consecutiveFailures} tentatives de connexion échouées depuis {ip}.',
    dsarScheduled: "Demande d'effacement planifiée",
    dsarScheduledBody:
      "Une demande d'effacement a été déposée pour une personne dans cette organisation. Elle s'exécutera dans {coolingOffHours} h. Ouvre le reçu pour la consulter ou l'annuler.",
    dsarApprovalNeeded: "Demande d'effacement en attente de ton approbation",
    dsarApprovalNeededBody:
      "Une demande d'effacement a été déposée et nécessite l'approbation d'un second admin avant de pouvoir s'exécuter.",
    dsarCancelled: "Demande d'effacement annulée",
    dsarCancelledBody:
      "Une demande d'effacement en attente a été annulée avant l'expiration de son délai de réflexion.",
    dsarPolicyTightened: 'Gouvernance DSAR renforcée',
    dsarPolicyTightenedBody:
      'La politique de gouvernance DSAR a été modifiée vers un réglage plus strict. Les modifications strictes prennent effet immédiatement.',
    dsarPolicyLoosenProposed: 'Assouplissement de la gouvernance DSAR proposé',
    dsarPolicyLoosenProposedBody:
      "Un assouplissement de la gouvernance DSAR a été proposé. Tout admin peut l'annuler avant l'expiration du délai de grâce de 24 heures.",
    dsarPolicyLoosenApplied: 'Gouvernance DSAR assouplie',
    dsarPolicyLoosenAppliedBody:
      "L'assouplissement proposé de la gouvernance DSAR a pris effet après le délai de grâce de 24 heures.",
    dsarPolicyLoosenCancelled:
      'Modification de politique DSAR en attente annulée',
    dsarPolicyLoosenCancelledBody:
      "L'assouplissement en attente de la gouvernance DSAR a été annulé avant de prendre effet.",
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
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params?.[name];
    if (value === undefined) return `{${name}}`;
    // Interpolation values are primitives in practice; stringify safely so an
    // unexpected object never renders as '[object Object]'.
    const str =
      typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : JSON.stringify(value);
    return escapeSlackText(str);
  });
}
