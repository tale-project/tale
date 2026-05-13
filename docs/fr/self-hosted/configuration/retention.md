---
title: Configuration de rétention
description: Configurez combien de temps les conversations, fichiers, journaux d'audit et exécutions sont conservés.
---

Tale dispose d'une configuration de rétention centrale qui s'applique à tous les domaines de données — conversations, fichiers téléversés, journaux d'audit, exécutions de workflows et enregistrements analytiques. Les valeurs par défaut conviennent à la plupart des déploiements ; ajustez-les lorsque la conformité, le coût ou les règles de confidentialité l'exigent.

Les bornes de rétention se résolvent en trois couches :

- **Fichier JSON par organisation** — baseline contrôlée par l'opérateur sous `$TALE_CONFIG_DIR/retention/{orgSlug}.json`. Le fichier JSON est l'unique source de vérité. Auto-amorcé par le conteneur Convex au premier démarrage par `TALE_VERSION`.
- **Variables d'environnement** — surcouche de resserrement définie par l'opérateur, appliquée par-dessus les valeurs du fichier. Peut uniquement resserrer min/max (élever le plancher, abaisser le plafond) ; ne peut pas assouplir au-delà des valeurs du fichier.
- **UI de Gouvernance** — valeurs par organisation à l'intérieur des bornes effectives de l'opérateur.

## Valeurs par défaut basées fichier (par organisation)

Les fichiers par organisation se trouvent sous `$TALE_CONFIG_DIR/retention/` :

- `default.json` — bornes de rétention + valeurs initiales pour l'organisation bootstrap. Le slug de l'organisation par défaut est codé en dur à `default`, donc le fichier respecte la convention `{orgSlug}.json` sans cas particulier.
- `{orgSlug}.json` (optionnel) — surcharges par organisation pour les autres organisations. Lorsqu'une organisation n'a pas son propre fichier, le résolveur retombe sur `default.json`.

Chaque fichier déclare un sous-ensemble quelconque des 16 catégories de rétention plus un bloc **`_metadata` racine** optionnel pour le binding env. Une catégorie présente dans le fichier DOIT contenir les trois champs :

```json
{
  "_metadata": {
    "envPrefix": "TALE_RETENTION_",
    "envNames": {
      "AUDIT_MIN": "auditLog.min",
      "AUDIT_MAX": "auditLog.max",
      "AUDIT_DEFAULT": "auditLog.default",
      "FILES_MIN": "documents.min",
      "FILES_MAX": "documents.max",
      "FILES_DEFAULT": "documents.default"
    }
  },
  "auditLog": { "min": 365, "max": 3650, "default": 730 },
  "documents": { "min": 30, "max": 3650, "default": 365 }
}
```

Où :

- `min` / `max` — bornes externes définies par l'opérateur. Les administrateurs d'organisation ne peuvent pas choisir de valeurs hors de cet intervalle.
- `default` — valeur initiale de rétention par organisation, utilisée jusqu'à ce qu'un administrateur la change via l'UI de Gouvernance.
- `_metadata` (racine, optionnel) — déclaration du binding env :
  - `envPrefix` — préfixe commun à tous les noms d'env. Les noms complets sont formés par concaténation pure : `${envPrefix}${suffix}`. Le séparateur (ex. `_`) fait partie d'`envPrefix` et est visible.
  - `envNames` — mapping 1:1 direct entre suffixe d'env → chemin JSON. Les chemins doivent correspondre à `${catégorie}.${min|max|default}` pour une catégorie connue.
  - `envPrefix` et `envNames` sont uniquement autorisés au niveau racine ; le schéma les rejette à l'intérieur d'une catégorie.

Les catégories absentes du fichier d'une organisation retombent sur le `default.json` de cette organisation. Si les deux sont absents (ex. l'opérateur a supprimé `default.json`), les lectures de rétention renvoient `RETENTION_CONFIG_MISSING` — redémarrez le conteneur avec `FORCE_SEED=true` (ou incrémentez `TALE_VERSION`) pour ré-amorcer `default.json` depuis l'`examples/retention/default.json` fourni.

`unit` (`days` vs `hours`) n'est pas configurable par catégorie — il est lié à la logique de cleanup et reste dans le code de la plateforme uniquement.

### Métadonnées d'affichage (par catégorie)

Les opérateurs peuvent ajouter un bloc `_metadata` optionnel par catégorie pour surcharger l'étiquette, le texte d'aide, l'ordre de tri et la visibilité affichés dans l'UI de Gouvernance :

```json
{
  "auditLog": {
    "min": 365,
    "max": 3650,
    "default": 730,
    "_metadata": {
      "label": "Rétention du journal d'audit (périmètre PCI)",
      "help": "Verrouillé par l'opérateur pour notre programme de conformité.",
      "order": 1,
      "hidden": false
    }
  }
}
```

Le binding env (`envPrefix` / `envNames`) est uniquement autorisé au niveau racine `_metadata` — à l'intérieur d'une catégorie, ces champs sont rejetés par le schéma.

### Page d'admin « Environment »

L'entrée **Environment** dans la barre latérale de Gouvernance affiche un instantané en lecture seule de chaque variable d'env liée à la rétention que le résolveur considère actuellement — nom, valeur courante, source du binding (`metadata` lorsque déclarée dans `_metadata.envNames`, `none` sinon), et si elle est actuellement en train de resserrer.

Après modification d'un fichier, le prochain rechargement de l'éditeur prend automatiquement les nouvelles valeurs — pas de redémarrage Convex nécessaire.

## Variables d'environnement (surcouche de resserrement)

Le `docker-entrypoint.sh` de la plateforme synchronise par défaut chaque variable d'env du conteneur plateforme vers Convex (comportement aligné avec `bun run dev`). Une petite `ENV_SYNC_DENYLIST` au début de l'entrypoint est la seule charge de maintenance côté plateforme — elle est actuellement vide et ne grossit que lorsqu'une variable spécifique entre en conflit avec Convex. Les opérateurs n'ont pas besoin de négocier une allowlist côté plateforme pour ajouter leurs propres variables d'env.

Elles s'appliquent à toutes les organisations du déploiement, par-dessus les valeurs des fichiers par organisation. Elles peuvent uniquement RESSERRER les bornes — élever un plancher ou abaisser un plafond — jamais assouplir au-delà de ce que le fichier déclare. Toutes les valeurs sont en jours sauf indication contraire.

Les noms d'env ci-dessous proviennent de la map `_metadata.envNames` racine de l'`examples/retention/default.json` livré. `envPrefix` est `"TALE_RETENTION_"` (avec underscore final). Les noms complets sont formés par concaténation pure : `envPrefix + suffix`.

| Variable                                     | Min     | Max    | Initial | Régit                                                                                                                           |
| -------------------------------------------- | ------- | ------ | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `TALE_RETENTION_CONVERSATIONS_MIN` / `_MAX`  | `1`     | `3650` | `90`    | Conversations et leurs messages.                                                                                                |
| `TALE_RETENTION_FILES_MIN` / `_MAX`          | `30`    | `3650` | `365`   | Fichiers téléversés (chat ou base de connaissances).                                                                            |
| `TALE_RETENTION_AUDIT_MIN` / `_MAX`          | `365`   | `3650` | `730`   | Entrées de journal d'audit. Min codé en dur à 365 j (PCI/SOC2/ISO baseline) — l'opérateur ne peut qu'AUGMENTER.                 |
| `TALE_RETENTION_EXECUTIONS_MIN` / `_MAX`     | `1`     | `365`  | `30`    | Détails d'exécution de workflow.                                                                                                |
| `TALE_RETENTION_ANALYTICS_MIN` / `_MAX`      | `30`    | `3650` | `365`   | Lignes analytiques par requête.                                                                                                 |
| `TALE_RETENTION_CHAT_FILTER_MIN` / `_MAX`    | `1`     | `365`  | `90`    | Télémétrie chat-filter (PII / liste de mots / modération).                                                                      |
| `TALE_RETENTION_PROMPTS_MIN` / `_MAX`        | `30`    | `3650` | `730`   | Modèles de prompts enregistrés (org-scope).                                                                                     |
| `TALE_RETENTION_FEEDBACK_MIN` / `_MAX`       | `30`    | `3650` | `365`   | Feedbacks par message. Peut contenir du contenu utilisateur cité.                                                               |
| `TALE_RETENTION_MEMORY_AUDIT_MIN` / `_MAX`   | `30`    | `3650` | `365`   | Journal des changements de la mémoire de personnalisation.                                                                      |
| `TALE_RETENTION_CUSTOMERS_MIN` / `_MAX`      | `30`    | `3650` | `730`   | Fiches client CRM (nom, email, adresse, locale, métadonnées).                                                                   |
| `TALE_RETENTION_VENDORS_MIN` / `_MAX`        | `30`    | `3650` | `730`   | Fiches fournisseurs (nom, email, téléphone, adresse, notes).                                                                    |
| `TALE_RETENTION_INBOX_MIN` / `_MAX`          | `30`    | `3650` | `730`   | Boîte de réception canal client externe (`externalConversations`) + corps de messages cascadés.                                 |
| `TALE_RETENTION_MSG_META_MIN` / `_MAX`       | `30`    | `3650` | `365`   | Raisonnement par message, fenêtre de contexte de prompt, E/S d'outils. Données dérivées à fort PII.                             |
| `TALE_RETENTION_USER_TEMP_MIN` / `_MAX`      | `1`     | `720`  | `24`    | Fichiers temporaires côté utilisateur (heures).                                                                                 |
| `TALE_RETENTION_AGENT_TEMP_MIN` / `_MAX`     | `1`     | `720`  | `24`    | Fichiers temporaires côté agent (heures).                                                                                       |
| `TALE_RETENTION_LOGIN_ATTEMPTS_MIN` / `_MAX` | `90`    | `365`  | `90`    | Enregistrements de tentatives de connexion.                                                                                     |
| `TALE_RETENTION_DISABLED`                    | `false` | —      | —       | Lorsque `true`, le job de nettoyage est no-op avec un warn-log. Coupe-circuit opérateur pour les fenêtres de migration / debug. |

Les changements aux variables d'environnement prennent effet au **prochain redémarrage du backend** (`docker compose restart tale-convex`) — Convex met l'env en cache au démarrage du processus.

## Politique par organisation

Dans les bornes effectives de l'opérateur, un admin d'org peut configurer chaque catégorie indépendamment dans l'UI de Gouvernance. Le formulaire récupère les bornes effectives via l'action V8 `getRetentionBoundsAction` (qui lit le fichier par organisation avec retombée sur `default.json` et applique le resserrement env) et rend `<input min={N} max={M}>` plus un texte d'aide en ligne AVANT que l'utilisateur ne tape une valeur hors plage. Les enregistrements qui violent une borne sont rejetés avec `RETENTION_BELOW_FLOOR` ou `RETENTION_EXCEEDS_CEILING` (chacun avec la borne exacte + source).

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

Les tentatives de connexion sont email-scoped (pas org-scoped) et s'exécutent en un seul passage global avec un TTL fixe de 30 jours. La configuration par organisation `loginAttemptRetentionDays` ne régit pas ce passage, et le TTL n'est intentionnellement pas configurable par variable d'environnement afin de maintenir un seuil forensique uniforme pour les enquêtes de force brute sur tous les déploiements.

## Conservation légale (Legal Hold)

Lorsqu'une ligne `legalHolds` existe pour `(organizationId, targetType, targetId)` ET `releasedAt === undefined`, le runner de nettoyage refuse de supprimer physiquement l'entité correspondante. La conservation est collante : `restoreChatThread` refuse également tant qu'une conservation est active.

Types de cible : `thread`, `document`, `execution`, `userMembership`, `org`. Une conservation à l'échelle de l'org (`targetType: 'org'`) court-circuite l'ensemble du passage de nettoyage pour cette org.

Les conservations sont placées via `placeLegalHold` (admin uniquement). La levée suit un flux maker-checker EN DEUX ÉTAPES : un admin dépose la demande via `requestLegalHoldRelease`, et un AUTRE admin approuve via `approveLegalHoldRelease`. L'approbation impose un cooldown de 24h (configurable via `TALE_LEGAL_HOLD_RELEASE_COOLDOWN_HOURS`) plus un délai minimum de 5 minutes entre la demande et l'approbation pour contrer les attaques en chaîne. `rejectLegalHoldRelease` est le chemin de rejet. L'auto-approbation est refusée sauf si l'opérateur opte explicitement en définissant `TALE_LEGAL_HOLD_SINGLE_ADMIN_OK=true` (déploiements à admin unique) — le journal d'audit enregistre `legal_hold_release_approved_self` pour que le contournement soit visible. Les conservations levées sont conservées dans la table pour la trace d'audit — jamais supprimées physiquement.

Les conservations à l'échelle de l'org (`targetType: 'org'`, la conservation « halte totale ») exigent par défaut un double contrôle ; le placement est refusé sauf si `TALE_LEGAL_HOLD_SINGLE_ADMIN_OK=true` est défini.

Fermer une `legalMatter` via `closeLegalMatter` dépose automatiquement une demande de levée pour chaque conservation active liée (matchée par `matterRef`). L'approbation requiert toujours un second admin par conservation liée — la fermeture du matter ne lève PAS automatiquement.

Le runner de nettoyage pré-charge chaque conservation active UNE FOIS par exécution, de sorte que les passages en cours voient un snapshot cohérent. Les conservations placées en cours d'exécution protègent la _prochaine_ exécution ; cette brève fenêtre est acceptable selon ISO 27050 puisque le nettoyage est quotidien.

## Protection PII de la chaîne d'audit

Le journal d'audit est conservé pendant des années (par défaut 730 jours, plancher 365). Pour empêcher cette chaîne de transporter des adresses email et IP en clair issues d'entrées utilisateur non authentifiées sur le long terme (en particulier les tentatives de connexion échouées), définissez `TALE_AUDIT_PEPPER` sur un secret unique d'au moins 16 caractères. Les nouvelles lignes d'audit stockent alors un hash HMAC-SHA256 de l'email et un préfixe réseau grossier de l'IP (`/24` pour v4, `/64` pour v6) dans des colonnes dédiées `actorEmailHash` / `actorIpHash` ; les colonnes en clair restent vides. Les lignes existantes ne sont pas réécrites — la rotation invalide la corrélation à la frontière, ce qui est l'intention de l'opérateur.

Lorsque `TALE_AUDIT_PEPPER` est non défini ou plus court que 16 caractères, les écrivains d'audit retombent sur le clair et émettent un avertissement `[SECURITY]` unique sur stderr lors du premier appel. Définissez la variable en production avant d'exposer le déploiement à de vrais utilisateurs.

`TALE_AUDIT_SIGNING_KEY` (distincte du pepper) signe les lignes `auditLogCheckpoints` afin que le vérificateur d'intégrité distingue une frontière de rétention/scrub PII délibérée d'une falsification. Sans clé de signature, la chaîne reste à preuve d'altération via la chaîne SHA-256 elle-même ; la signature est une défense en profondeur contre un attaquant capable à la fois de supprimer des lignes et de forger un nouveau checkpoint.

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

- [Référence des variables d'environnement](/fr/self-hosted/configuration/environment-reference) — liste complète des variables d'environnement de Tale.
- [Gouvernance](/fr/platform/admin/governance) — paramètres de rétention par organisation et gestion des conservations légales.
