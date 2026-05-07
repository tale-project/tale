---
title: Configuration de rétention
description: Configurez combien de temps les conversations, fichiers, journaux d'audit et exécutions sont conservés.
---

Tale dispose d'une configuration de rétention centrale qui s'applique à tous les domaines de données — conversations, fichiers téléversés, journaux d'audit, exécutions de workflows et enregistrements analytiques. Les valeurs par défaut conviennent à la plupart des déploiements ; ajustez-les lorsque la conformité, le coût ou les règles de confidentialité l'exigent.

La rétention peut être configurée à deux endroits :

- **Variables d'environnement** — bornes définies par l'opérateur. Les administrateurs d'organisation ne peuvent pas les assouplir.
- **UI de Gouvernance** — valeurs par organisation à l'intérieur des bornes de l'opérateur.

## Variables d'environnement

Elles s'appliquent à toutes les organisations du déploiement. Toutes les valeurs sont en jours sauf indication contraire. Couplez `_MIN_DAYS` et `_MAX_DAYS` par catégorie — les opérateurs peuvent resserrer les valeurs par défaut mais jamais les assouplir.

| Variable                                              | Min défaut | Max défaut | Régit                                                                                                                           |
| ----------------------------------------------------- | ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `TALE_RETENTION_CONVERSATIONS_MIN_DAYS` / `_MAX_DAYS` | `1`        | `3650`     | Conversations et leurs messages.                                                                                                |
| `TALE_RETENTION_FILES_MIN_DAYS` / `_MAX_DAYS`         | `30`       | `3650`     | Fichiers téléversés (chat ou base de connaissances).                                                                            |
| `TALE_RETENTION_AUDIT_MIN_DAYS` / `_MAX_DAYS`         | `365`      | `3650`     | Entrées de journal d'audit. Min codé en dur à 365 j (PCI/SOC2/ISO baseline) — l'opérateur ne peut qu'AUGMENTER.                 |
| `TALE_RETENTION_EXECUTIONS_MIN_DAYS` / `_MAX_DAYS`    | `1`        | `365`      | Détails d'exécution de workflow.                                                                                                |
| `TALE_RETENTION_ANALYTICS_MIN_DAYS` / `_MAX_DAYS`     | `30`       | `3650`     | Lignes analytiques par requête.                                                                                                 |
| `TALE_RETENTION_CHAT_FILTER_MIN_DAYS` / `_MAX_DAYS`   | `1`        | `365`      | Télémétrie chat-filter (PII / liste de mots / modération).                                                                      |
| `TALE_RETENTION_PROMPTS_MIN_DAYS` / `_MAX_DAYS`       | `30`       | `3650`     | Modèles de prompts enregistrés (org-scope).                                                                                     |
| `TALE_RETENTION_FEEDBACK_MIN_DAYS` / `_MAX_DAYS`      | `30`       | `3650`     | Feedbacks par message. Peut contenir du contenu utilisateur cité.                                                               |
| `TALE_RETENTION_MEMORY_AUDIT_MIN_DAYS` / `_MAX_DAYS`  | `30`       | `3650`     | Journal des changements de la mémoire de personnalisation.                                                                      |
| `TALE_RETENTION_CUSTOMERS_MIN_DAYS` / `_MAX_DAYS`     | `30`       | `3650`     | Fiches client CRM (nom, e-mail, adresse, locale, métadonnées).                                                                  |
| `TALE_RETENTION_VENDORS_MIN_DAYS` / `_MAX_DAYS`       | `30`       | `3650`     | Fiches fournisseurs (nom, e-mail, téléphone, adresse, notes).                                                                   |
| `TALE_RETENTION_INBOX_MIN_DAYS` / `_MAX_DAYS`         | `30`       | `3650`     | Boîte de réception canal client externe (intégrations e-mail/chat) + corps de messages cascadés.                                |
| `TALE_RETENTION_MSG_META_MIN_DAYS` / `_MAX_DAYS`      | `30`       | `3650`     | Raisonnement par message, fenêtre de contexte de prompt, E/S d'outils. Données dérivées à fort PII.                             |
| `TALE_RETENTION_USER_TEMP_MIN_HOURS` / `_MAX_HOURS`   | `1`        | `720`      | Fichiers temporaires côté utilisateur (heures).                                                                                 |
| `TALE_RETENTION_AGENT_TEMP_MIN_HOURS` / `_MAX_HOURS`  | `1`        | `720`      | Fichiers temporaires côté agent (heures).                                                                                       |
| `TALE_RETENTION_DISABLED`                             | `false`    | —          | Lorsque `true`, le job de nettoyage est no-op avec un warn-log. Coupe-circuit opérateur pour les fenêtres de migration / debug. |

Les changements aux variables d'environnement prennent effet au **prochain redémarrage du backend** (`docker compose restart tale-convex`) — Convex met l'env en cache au démarrage du processus.

## Politique par organisation

Dans les bornes de l'opérateur, un admin d'org peut configurer chaque catégorie indépendamment dans l'UI de Gouvernance. Le formulaire récupère les bornes effectives via `getEffectiveRetentionBounds` et rend `<input min={N} max={M}>` plus un texte d'aide en ligne AVANT que l'utilisateur ne tape une valeur hors plage. Les enregistrements qui violent une borne sont rejetés avec `RETENTION_BELOW_FLOOR` ou `RETENTION_EXCEEDS_CEILING` (chacun avec la borne exacte + source).

## Comment fonctionne la suppression

Le job de suppression s'exécute chaque nuit à 04:00 UTC. Le dispatcher de haut niveau planifie un nettoyage par organisation séparé avec un décalage déterministe basé sur le hash de 0 à 15 minutes, afin que RAG et la base de données ne voient pas une rafale de type thundering-herd à chaque tick cron. Un cron parallèle à 01:00 UTC exécute `effectReleasesOnly` pour que les libérations de legal-hold approuvées prennent effet après leur cooldown de 24h, même quand la rétention est mise en pause via `TALE_RETENTION_DISABLED`.

Pour chaque organisation, toutes les catégories s'exécutent dans l'ordre de priorité :

1. Documents (entrées RAG supprimées via `ragFetch` authentifié)
2. Fichiers temporaires utilisateur
3. Fichiers temporaires agent
4. Historique de chat (cascade-supprime message metadata, threadTodos, approvals, threadBranches, messageFeedback, chatFilterEvents, artifacts + révisions, agentWebhookUserThreads, sub-threads, messages agent-component, puis l'enregistrement threadMetadata lui-même)
5. Journaux d'audit (écrit une ligne `auditLogCheckpoints` capturant tête de chaîne + nombre + timestamp max afin que la chaîne SHA-256 reste vérifiable à travers la coupure d'archivage)
6. Journaux de workflow
7. Événements chat-filter
8. Usage ledger

Les tentatives de connexion sont email-scoped (pas org-scoped) et s'exécutent en un seul passage global avec un TTL fixe de 30 jours.

## Conservation légale (Legal Hold)

Lorsqu'une ligne `legalHolds` existe pour `(organizationId, targetType, targetId)` ET `releasedAt === undefined`, le runner de nettoyage refuse de supprimer physiquement l'entité correspondante. La conservation est collante : `restoreChatThread` refuse également tant qu'une conservation est active.

Types de cible : `thread`, `document`, `execution`, `userMembership`, `org`. Une conservation à l'échelle de l'org (`targetType: 'org'`) court-circuite l'ensemble du passage de nettoyage pour cette org.

Les conservations sont placées via `placeLegalHold` et levées via un flux maker-checker (`requestLegalHoldRelease` + `approveLegalHoldRelease`, l'approuveur doit différer du demandeur, cooldown de 24h après approbation). Les conservations levées sont conservées dans la table pour la trace d'audit — jamais supprimées physiquement.

## Effacement RGPD Art 17

Pour les demandes d'effacement vérifiées, un admin peut appeler `requestErasure(organizationId, userId, reason)` pour effacer immédiatement par cascade chaque thread que l'utilisateur nommé possède dans cette org. Cela CONTOURNE la fenêtre de grâce de rétention et le cooldown-on-shortening (afin que l'effacement se produise « sans retard injustifié » conformément à l'art 17). Refusé si une conservation légale correspondante est active.

Sous-type d'audit `gdpr_erasure_executed` (`category: 'admin'`) enregistre acteur, raison, threads effacés et toute liste d'éléments bloqués par conservation.

## Ce qui est supprimé

- Les lignes sont supprimées de la base de données.
- Les fichiers associés sont supprimés du stockage d'objets.
- Les embeddings vectoriels des documents supprimés sont retirés du knowledge store.
- Pour la rétention de l'historique de chat, chaque ligne descendante (messages, metadata, todos, feedback, artifacts, etc.) est supprimée en cascade via le helper partagé `cascadeDeleteThreadChildren`, afin que la suppression utilisateur et la suppression de rétention ne divergent jamais sur les tables nettoyées.
- La rétention des journaux d'audit écrit une ligne `auditLogCheckpoints` à chaque limite de batch afin que la chaîne de hash SHA-256 reste vérifiable.

## Voir aussi

- [Référence des variables d'environnement](/self-hosted/configuration/environment-reference) — liste complète des variables d'environnement de Tale.
- [Gouvernance](/platform/admin/governance) — paramètres de rétention par organisation et gestion des conservations légales.
