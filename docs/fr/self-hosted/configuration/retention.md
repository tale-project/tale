---
title: Configuration de rétention
description: Configure combien de temps les conversations, fichiers, journaux d'audit et exécutions sont conservés.
---

La rétention contrôle combien de temps chaque catégorie de données que Tale stocke reste en vie — conversations de chat, fichiers téléversés, lignes du journal d'audit, détail d'exécution de workflow, lignes d'analytique, fiches clients et une dizaine d'autres. Cette page s'adresse aux opérateurs qui doivent ajuster ces bornes pour des raisons de conformité, de coût ou de confidentialité ; le réglage par organisation accessible dans l'application, qui tourne dans les bornes que l'opérateur a posées, vit sous [Gouvernance](/fr/platform/admin/governance). Les valeurs par défaut livrées sont assez prudentes pour la plupart des installations, donc la plupart des opérateurs laissent les couches fichier et environnement tranquilles et ne touchent que le curseur par organisation dans l'interface.

Le modèle a trois couches. Le **fichier JSON par organisation** pose les bornes externes. Les **variables d'environnement** resserrent ces bornes (élèvent le plancher, abaissent le plafond) par-dessus. L'**interface Gouvernance** choisit une valeur dans ce que l'opérateur a laissé disponible. Chaque couche ne peut que resserrer la suivante — l'opérateur ne peut jamais étendre ce que le fichier déclare.

## Valeurs par défaut par organisation, basées sur des fichiers

Les fichiers par organisation vivent sous `$TALE_CONFIG_DIR/retention/`. Le conteneur Convex les sème au premier démarrage par `TALE_VERSION` ; les éditions ultérieures prennent effet à la lecture suivante parce que le fichier est consulté à chaque action de rétention.

- `default.json` — les bornes et valeurs initiales de l'organisation amorce. Chaque organisation sans fichier propre retombe sur celui-ci.
- `{orgSlug}.json` (optionnel) — surcharges par organisation pour les organisations supplémentaires.

Chaque fichier déclare n'importe quel sous-ensemble des seize catégories de rétention, plus un bloc racine optionnel `_metadata`. Une catégorie présente dans le fichier doit inclure `min`, `max` et `default` ; un bloc `_metadata` par catégorie pour des surcharges d'affichage est optionnel.

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
      "FILES_DEFAULT": "documents.default",
      "INBOX_MIN": "externalConversations.min",
      "INBOX_MAX": "externalConversations.max",
      "INBOX_DEFAULT": "externalConversations.default"
    }
  },
  "auditLog": { "min": 365, "max": 3650, "default": 730 },
  "documents": { "min": 30, "max": 3650, "default": 365 },
  "externalConversations": { "min": 30, "max": 3650, "default": 730 }
}
```

`min` et `max` sont les bornes externes définies par l'opérateur — les Admins d'organisation ne peuvent pas choisir de valeurs hors de cette plage. `default` est la valeur de rétention initiale par organisation, utilisée jusqu'à ce qu'un Admin d'organisation la change dans **Gouvernance**. La carte racine `_metadata.envPrefix` et `_metadata.envNames` déclare la liaison entre variable d'environnement et champ JSON ; chaque entrée dit « cette variable d'environnement contrôle ce champ ». Les chemins doivent matcher `${category}.${min|max|default}` pour une catégorie de rétention connue. `envPrefix` et `envNames` ne sont autorisés que dans le `_metadata` racine — les placer à l'intérieur d'un `_metadata` par catégorie est rejeté à la validation du schéma.

Les catégories absentes d'un fichier d'organisation retombent sur le `default.json` de cette organisation. Si les deux sont absents — par exemple, l'opérateur a supprimé `default.json` — les lectures de rétention retournent `RETENTION_CONFIG_MISSING`. Redémarre le conteneur Convex avec `FORCE_SEED=true` (ou incrémente `TALE_VERSION`) pour resemer `default.json` depuis l'`examples/retention/default.json` livré.

L'unité de catégorie (jours versus heures) n'est pas configurable par catégorie — elle est liée à la mécanique de nettoyage du runtime et vit dans le code de la plateforme. Après l'édition d'un fichier, l'action de rétention suivante prend les nouvelles valeurs automatiquement parce que l'I/O fichier a lieu à chaque lecture ; aucun redémarrage de Convex n'est requis.

### Coercition de type sur la liaison d'environnement

Les variables d'environnement sont des chaînes plates. Le résolveur coerce chacune selon le type runtime du champ : `number` via `parseInt` ou `parseFloat` ; `string` tel quel ; `boolean` depuis `"true"` ou `"false"` (insensible à la casse) ; `date` au format ISO 8601 ; `array<scalar>` séparé par `,` avec chaque élément coercé. Les objets complexes, les enregistrements imbriqués et les unions discriminées ne peuvent pas porter de liaison d'environnement — mettre des données structurées dans une seule chaîne d'environnement est ambigu et perd de l'information. Pour la rétention en particulier, chaque champ liable est un entier, donc la règle est théorique ici ; elle compte quand le même schéma `_metadata.envPrefix` sera réutilisé pour de futures zones de configuration.

### Surcharges d'affichage

Un bloc `_metadata` au niveau catégorie porte des champs optionnels d'affichage pour l'éditeur Gouvernance. `label` et `help` masquent les chaînes i18n de la plateforme ; `order` et `hidden` changent la mise en page visuelle.

```json
{
  "auditLog": {
    "min": 365,
    "max": 3650,
    "default": 730,
    "_metadata": {
      "label": "Audit log retention (PCI scope)",
      "help": "Operator-pinned for our compliance program.",
      "order": 1,
      "hidden": false
    }
  }
}
```

Avec `hidden: true`, la catégorie disparaît de l'éditeur ; le comportement de nettoyage reste inchangé parce que les bornes s'appliquent toujours. La liaison d'environnement vit dans la racine `_metadata`, jamais par catégorie.

### La page admin Environnement

L'entrée **Environnement** dans la barre latérale Gouvernance est un instantané en lecture seule de chaque variable d'environnement de rétention que le résolveur considère actuellement — nom, valeur courante, source de liaison (`metadata` quand déclarée dans `_metadata.envNames`, `none` quand aucune entrée ne pointe sur ce champ), et si elle resserre activement quelque chose. C'est la réponse à « ma surcharge est-elle vraiment branchée ? » — utile quand une valeur d'environnement semble n'avoir aucun effet.

## Variables d'environnement (couche de resserrement)

Les surcharges d'environnement s'appliquent à toutes les organisations du déploiement, par-dessus les valeurs des fichiers par organisation. Elles ne peuvent que resserrer — élever un plancher ou abaisser un plafond — jamais relâcher au-delà de ce que le fichier déclare.

Les bornes effectives qu'un Admin d'organisation voit viennent de `max(file_min, env_MIN)` pour le plancher et de `min(file_max, env_MAX)` pour le plafond. Mettre une variable d'environnement à `0` est rejeté comme une erreur parce que ça écraserait la plage valide ; les variables d'environnement vides ou absentes retombent sur la valeur du fichier. Les valeurs d'environnement qui tentent d'étendre une borne sont silencieusement plafonnées à la valeur du fichier — pas d'erreur, pas d'avertissement.

L'entrypoint de la plateforme synchronise par défaut chaque variable d'environnement du conteneur plateforme vers Convex (correspondant au comportement local `bun run dev`). Un petit tableau `ENV_SYNC_DENYLIST` près du sommet de l'entrypoint est la seule maintenance côté plateforme ; il est actuellement vide et ne grandit que quand une variable précise se révèle entrer activement en conflit avec Convex. Les opérateurs n'ont pas à négocier des mises à jour de liste blanche côté plateforme pour ajouter des variables d'environnement personnalisées.

Les colonnes ci-dessous montrent le plancher, le plafond et les valeurs initiales **livrés** depuis l'`examples/retention/default.json` du paquet. Les opérateurs peuvent les changer en éditant `$TALE_CONFIG_DIR/retention/default.json` ; les surcharges d'environnement s'appliquent par-dessus. Pour renommer une liaison, lier un champ différemment ou ajouter une nouvelle liaison, édite `_metadata.envNames` directement — pas de changement de code requis.

| Variable                                     | Plancher | Plafond | Initial | Gouverne                                                                                                        |
| -------------------------------------------- | -------- | ------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| `TALE_RETENTION_CONVERSATIONS_MIN` / `_MAX`  | `1`      | `3650`  | `90`    | Conversations de chat et leurs messages.                                                                        |
| `TALE_RETENTION_FILES_MIN` / `_MAX`          | `30`     | `3650`  | `365`   | Fichiers téléversés attachés au chat ou à la base de connaissances.                                             |
| `TALE_RETENTION_AUDIT_MIN` / `_MAX`          | `365`    | `3650`  | `730`   | Entrées du journal d'audit. Plancher figé à 365 jours (référence PCI/SOC2/ISO) — l'opérateur ne peut qu'élever. |
| `TALE_RETENTION_EXECUTIONS_MIN` / `_MAX`     | `1`      | `365`   | `30`    | Détail d'exécution de workflow.                                                                                 |
| `TALE_RETENTION_ANALYTICS_MIN` / `_MAX`      | `30`     | `3650`  | `365`   | Lignes d'analytique d'usage par requête.                                                                        |
| `TALE_RETENTION_CHAT_FILTER_MIN` / `_MAX`    | `1`      | `365`   | `90`    | Télémétrie des filtres de chat (PII, mots interdits, modération).                                               |
| `TALE_RETENTION_PROMPTS_MIN` / `_MAX`        | `30`     | `3650`  | `730`   | Modèles de prompts enregistrés (portée organisation uniquement).                                                |
| `TALE_RETENTION_FEEDBACK_MIN` / `_MAX`       | `30`     | `3650`  | `365`   | Pouces et commentaires par message. Peut contenir du contenu utilisateur cité.                                  |
| `TALE_RETENTION_MEMORY_AUDIT_MIN` / `_MAX`   | `30`     | `3650`  | `365`   | Journal des changements de mémoire de personnalisation.                                                         |
| `TALE_RETENTION_CUSTOMERS_MIN` / `_MAX`      | `30`     | `3650`  | `730`   | Fiches clients CRM (nom, courriel, adresse, locale, métadonnées).                                               |
| `TALE_RETENTION_VENDORS_MIN` / `_MAX`        | `30`     | `3650`  | `730`   | Fiches fournisseurs (nom, courriel, téléphone, adresse, notes libres).                                          |
| `TALE_RETENTION_INBOX_MIN` / `_MAX`          | `30`     | `3650`  | `730`   | Boîte de réception externe pour conversations clients.                                                          |
| `TALE_RETENTION_MSG_META_MIN` / `_MAX`       | `30`     | `3650`  | `365`   | Raisonnement par message, fenêtre de contexte du prompt, I/O des outils. Données dérivées à fort PII.           |
| `TALE_RETENTION_USER_TEMP_MIN` / `_MAX`      | `1`      | `720`   | `24`    | Fichiers temporaires côté utilisateur (heures).                                                                 |
| `TALE_RETENTION_AGENT_TEMP_MIN` / `_MAX`     | `1`      | `720`   | `24`    | Fichiers temporaires côté agent (heures).                                                                       |
| `TALE_RETENTION_LOGIN_ATTEMPTS_MIN` / `_MAX` | `90`     | `365`   | `90`    | Lignes de tentatives de connexion.                                                                              |
| `TALE_RETENTION_DISABLED`                    | `false`  | —       | —       | À `true`, l'action de nettoyage est un no-op avec un warn-log. Coupe-circuit opérateur pour migrations/debug.   |

Les changements de variables d'environnement prennent effet au redémarrage backend suivant (`docker compose restart tale-convex`) — Convex met l'environnement en cache au démarrage du processus.

## Politique par organisation

Dans les bornes effectives de l'opérateur, un Admin d'organisation configure chaque catégorie indépendamment dans l'interface Gouvernance. Le formulaire récupère les bornes, rend un champ pré-borné à `min` et `max`, et rejette à l'enregistrement les valeurs hors plage avec `RETENTION_BELOW_FLOOR` ou `RETENTION_EXCEEDS_CEILING`. L'une ou l'autre erreur nomme la borne exacte et la source (`file` ou `env`), pour que l'Admin d'organisation sache à quelle couche en vouloir.

## Comment la suppression tourne

Le job de suppression tourne chaque nuit à 04:00 UTC. Le dispatcher de premier niveau planifie un nettoyage séparé par organisation avec un étalement déterministe basé sur le hash de 0 à 15 minutes pour que RAG et la base ne voient pas une rafale de troupeau au galop à chaque tic du cron. Un cron frère à 01:00 UTC fait tourner `effectReleasesOnly` pour que les levées de séquestre légal approuvées et passées leur fenêtre de 24 heures prennent effet même quand la rétention est en pause via `TALE_RETENTION_DISABLED`.

Pour chaque organisation, chaque catégorie tourne dans l'ordre de priorité :

1. Documents (entrées RAG supprimées via `ragFetch` authentifié).
2. Fichiers temporaires côté utilisateur.
3. Fichiers temporaires côté agent.
4. Historique de chat (suppression en cascade des métadonnées de message, todos de thread, approbations, branches, retours, événements de filtre de chat, artefacts et leurs révisions, sous-threads, messages de composants d'agent, puis la ligne `threadMetadata` elle-même).
5. Journaux d'audit (écrit une ligne de checkpoint qui capture la tête de chaîne, le compte et l'horodatage max pour que la chaîne de hash SHA-256 reste vérifiable à travers la coupe).
6. Journaux de workflow.
7. Événements de filtre de chat.
8. Grand livre d'usage.

Les tentatives de connexion sont portées par courriel (pas par organisation) et tournent en une seule passe globale avec un TTL fixe de 30 jours. La configuration par organisation `loginAttemptRetentionDays` ne gouverne pas ce balayage, et le TTL n'est volontairement pas réglable par environnement pour garder le plancher de forensique brute-force uniforme à travers les déploiements.

## Mise sous séquestre légal

Quand une ligne `legalHolds` existe pour `(organizationId, targetType, targetId)` et que `releasedAt` est indéfini, le runner de nettoyage refuse de supprimer physiquement l'entité correspondante. Le séquestre est collant : `restoreChatThread` refuse aussi tant qu'un séquestre est actif.

Types de cible : `thread`, `document`, `execution`, `userMembership`, `org`. Un séquestre sur toute l'organisation (`targetType: 'org'`) court-circuite l'intégralité de la passe de nettoyage pour cette organisation.

Les séquestres sont posés via `placeLegalHold` (Admin uniquement). La levée est un flux maker-checker en deux étapes : n'importe quel Admin dépose via `requestLegalHoldRelease`, et un Admin différent approuve via `approveLegalHoldRelease`. L'approbation impose une fenêtre de 24 heures (configurable via `TALE_LEGAL_HOLD_RELEASE_COOLDOWN_HOURS`) plus un délai minimum de 5 minutes entre la demande et l'approbation pour neutraliser les attaques en chaîne. `rejectLegalHoldRelease` est le chemin de rejet. L'auto-approbation est refusée sauf si l'opérateur opte en posant `TALE_LEGAL_HOLD_SINGLE_ADMIN_OK=true` (déploiements mono-Admin) ; le journal d'audit consigne `legal_hold_release_approved_self` pour que le contournement soit visible.

Les séquestres à portée organisation (le séquestre « halte à toute rétention ») demandent un double contrôle par défaut ; le placement est refusé sauf si `TALE_LEGAL_HOLD_SINGLE_ADMIN_OK=true` est posé. Fermer un `legalMatter` via `closeLegalMatter` dépose automatiquement une demande de levée en attente pour chaque séquestre actif lié ; l'approbation demande quand même un second Admin par séquestre — la fermeture du dossier n'auto-libère pas. Les séquestres levés sont conservés dans la table pour la piste d'audit et ne sont jamais supprimés physiquement.

Le runner de nettoyage préfetch chaque séquestre actif une fois par passage, donc les passages en cours voient un instantané cohérent. Les séquestres posés en cours de passage protègent le passage suivant ; la brève fenêtre est acceptable selon ISO 27050 parce que le nettoyage est quotidien.

## Protection PII de la chaîne d'audit

Le journal d'audit est conservé pendant des années (par défaut 730 jours, plancher 365). Pour empêcher cette chaîne de porter sur la durée des adresses de courriel et des IP en clair venues d'entrées utilisateur non authentifiées (les tentatives de connexion échouées en particulier), pose `TALE_AUDIT_PEPPER` sur un secret unique d'au moins 16 caractères. Les nouvelles lignes d'audit stockent alors un hash HMAC-SHA256 du courriel et un préfixe réseau grossier de l'IP (`/24` en v4, `/64` en v6) dans des colonnes dédiées `actorEmailHash` et `actorIpHash` ; les colonnes en clair restent vides. Les lignes existantes ne sont pas réécrites — la rotation invalide la corrélation à travers la frontière, ce qui est l'intention de l'opérateur.

Quand `TALE_AUDIT_PEPPER` est absent ou plus court que 16 caractères, les écrivains d'audit retombent en clair et journalisent un avertissement unique `[SECURITY]` sur stderr au premier appel. Pose la variable en production avant d'exposer le déploiement à des utilisateurs réels.

`TALE_AUDIT_SIGNING_KEY` (séparée du pepper) signe les lignes de checkpoint du journal d'audit pour que le vérificateur d'intégrité distingue une frontière délibérée de rétention/scrub PII d'une altération. Sans clé de signature, la chaîne reste détectable comme altérée par la chaîne SHA-256 elle-même ; la signature est de la défense en profondeur contre un attaquant qui pourrait à la fois supprimer des lignes et forger un checkpoint frais.

## Effacement RGPD art. 17

Pour les demandes vérifiées d'effacement par la personne concernée, un Admin appelle `requestErasure(organizationId, userId, reason)` pour cascader immédiatement la suppression de chaque thread dont l'utilisateur nommé est propriétaire dans cette organisation. Cela contourne la fenêtre de grâce de rétention et la fenêtre sur raccourcissement pour que l'effacement ait lieu « sans retard injustifié » selon l'art. 17. Refusé si un séquestre légal correspondant est actif ; la réponse liste les éléments sous séquestre pour la référence de l'Admin.

Le sous-type d'audit `gdpr_erasure_executed` (catégorie `admin`) consigne l'acteur, la raison, les threads effacés et toute liste bloquée par séquestre.

## Ce qui est supprimé

Les lignes sont supprimées de la base. Les fichiers associés sont supprimés du stockage objet. Les embeddings vectoriels des documents supprimés sont retirés du stockage de connaissances. Pour la rétention de l'historique de chat, chaque ligne descendante — messages, métadonnées, todos, retours, artefacts et le reste — est supprimée en cascade via l'aide partagée, pour que suppression-utilisateur et suppression-rétention ne divergent jamais sur les tables nettoyées. La rétention du journal d'audit écrit une ligne de checkpoint à chaque frontière de lot pour que la chaîne de hash SHA-256 reste vérifiable.

## Où cela s'insère

La rétention est la politique de durée de vie par table pour tout ce que Tale stocke. Les valeurs par défaut sont prudentes ; les surcharges par organisation viennent de [Gouvernance](/fr/platform/admin/governance) ; et chaque variable d'environnement qui gate le comportement de rétention est cataloguée dans [Référence d'environnement](/fr/self-hosted/configuration/environment-reference). Ouvre cette page quand un responsable conformité demande combien de temps une table précise vit ; ouvre Gouvernance quand la réponse doit changer pour un locataire précis.
