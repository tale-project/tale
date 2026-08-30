---
title: Référence des variables d'environnement
description: Chaque variable d'environnement que Tale lit au boot, sa valeur par défaut et la surface produit qu'elle contrôle. La référence opérateur complète pour `.env`.
i18nLintExclude:
  - terminology-loanword
  - prose-exclamation
  - style-numbers
---

Tale lit sa configuration depuis un unique fichier `.env` à la racine du dépôt. Environ une douzaine de variables sont obligatoires au premier boot ; les autres ajustent le comportement. Cette page liste chaque variable que [`.env.example`](https://github.com/tale-project/tale/blob/main/.env.example) ship, sa valeur par défaut et la surface produit qui la consomme.

Les groupes sont ordonnés selon le moment où tu en as besoin la première fois : identité de domaine, TLS, secrets, base de données, instance, observabilité, chiffrement des fournisseurs. Si une variable change de valeur, redémarre le conteneur plateforme (`docker compose restart tale-platform tale-convex`) pour qu'elle prenne effet.

## Comment lire cette page

Chaque groupe est un tableau `Nom | Défaut | Description`. Les variables marquées **Obligatoire** doivent être définies pour que `docker compose up` réussisse. Les variables marquées **Optionnel** peuvent rester non définies ; la description nomme ce que désactiver la fonctionnalité signifie.

Le fichier `.env.example` ship des commentaires inline qui expliquent chaque variable dans son contexte ; cette page est la référence structurée et groupée pour le même ensemble.

## Identité de domaine (obligatoire au premier boot)

| Nom         | Défaut              | Description                                                                                                                               |
| ----------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `HOST`      | `localhost`         | **Obligatoire.** Nom d'hôte sans protocole. Utilisé pour le réseau Docker et le mail sortant.                                             |
| `SITE_URL`  | `https://localhost` | **Obligatoire.** URL canonique complète incluant le schéma et tout port non standard. Les callbacks d'auth l'utilisent.                   |
| `BASE_PATH` | non défini          | **Optionnel.** Préfixe de chemin pour les déploiements en sous-chemin derrière un reverse proxy (ex. `/app`). Laisse vide pour la racine. |

Le `SITE_URL` doit correspondre exactement à ce que l'utilisateur tape dans le navigateur. Un slash en queue, un port manquant ou `http` au lieu de `https` cassent le callback d'auth et produisent des boucles de sign-in.

## TLS

| Nom         | Défaut       | Description                                                                                                           |
| ----------- | ------------ | --------------------------------------------------------------------------------------------------------------------- |
| `TLS_MODE`  | `selfsigned` | Un de `selfsigned`, `letsencrypt`, `external`. Voir [TLS et domaines](/fr/self-hosted/configuration/tls-and-domains). |
| `TLS_EMAIL` | non défini   | E-mail de contact pour les notifications Let's Encrypt. Optionnel mais recommandé en production.                      |

`selfsigned` fait tourner Caddy avec un certificat généré — le navigateur avertit, OK pour le développement. `letsencrypt` exige un vrai domaine et les ports 80/443 joignables depuis l'Internet public. `external` fait servir Caddy en HTTP brut ; un reverse proxy amont termine TLS.

## Secrets de sécurité (obligatoire)

| Nom                     | Défaut                           | Description                                                                                                                                                                                                                                                                                 |
| ----------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`    | valeur d'exemple dans le fichier | **Obligatoire.** Secret base64 pour le signeur de session Better Auth. Génère avec `openssl rand -base64 32`. La rotation invalide chaque session.                                                                                                                                          |
| `ENCRYPTION_SECRET_HEX` | valeur d'exemple dans le fichier | **Obligatoire.** Clé hex de 32 octets. Clé AES-256 pour les credentials OAuth et connectors et entrée HKDF pour la secret-box des garde-fous. Génère avec `openssl rand -hex 32`. La rotation invalide chaque ciphertext en base ; les opérateurs doivent réinscrire les secrets concernés. |
| `INSTANCE_SECRET`       | valeur d'exemple dans le fichier | **Obligatoire.** Sert à dériver la clé admin Convex pour `tale deploy`. Le déploiement échoue si non défini.                                                                                                                                                                                |

Remplace les valeurs livrées dans `.env.example` avant d'exposer l'instance — ce sont des espaces réservés volontairement non sûrs.

## Base de données

Tale fait tourner deux bases Postgres : la base opérationnelle (`db`, port 5432) derrière le backend Convex, et le corpus de connaissances (`knowledge-db`, port 5433) qui détient les fragments de documents, les embeddings et les pages crawlées. Les deux sont ParadeDB et partagent `DB_PASSWORD`, mais elles sont indépendantes — pointe l'une ou l'autre vers une infrastructure externe séparément.

| Nom                      | Défaut                                                              | Description                                                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB_PASSWORD`            | `tale_password_change_me`                                           | **Obligatoire.** Mot de passe pour l'utilisateur Postgres auto-hébergé. Change-le avant la production. Utilisé par les deux conteneurs de base de données.                                                                      |
| `POSTGRES_URL`           | construit depuis `DB_PASSWORD`                                      | **Optionnel.** Override de l'URL de la base opérationnelle construite automatiquement. Utilise-le pour pointer sur un Postgres externe ou un hôte/port non standard.                                                            |
| `KNOWLEDGE_DATABASE_URL` | `postgresql://tale:${DB_PASSWORD}@knowledge-db:5432/tale_knowledge` | **Optionnel.** URL de connexion que le backend Convex utilise pour le corpus de connaissances. Override pour relocaliser le corpus vers ton propre ParadeDB géré — la banque sensible à la résidence se déplace indépendamment. |
| `KNOWLEDGE_DB_NAME`      | `tale_knowledge`                                                    | **Optionnel.** Nom de la base de connaissances. Le conteneur `knowledge-db` fourni crée cette base au premier boot.                                                                                                             |

La forme opérationnelle auto-construite est `postgresql://tale:${DB_PASSWORD}@db:5432`. Convex attend cette URL sans nom de base ; le nom est dérivé de la configuration d'instance. Le corpus de connaissances vit dans `tale_knowledge` avec les schémas `private_knowledge` et `public_web` ; l'UI **Paramètres > Résidence des données** écrit une config par banque plus riche que ces variables brutes, couverte dans [Résidence des données](/fr/self-hosted/configuration/data-residency).

## Observabilité

| Nom                         | Défaut     | Description                                                                                                                                  |
| --------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `SENTRY_DSN`                | non défini | DSN Sentry pour le suivi d'erreurs. Laisse vide pour désactiver. Compatible avec GlitchTip et Bugsink auto-hébergés.                         |
| `SENTRY_TRACES_SAMPLE_RATE` | non défini | Taux d'échantillonnage optionnel pour les traces de performance (`0.0`–`1.0`). Le comportement par défaut dépend du déploiement.             |
| `METRICS_BEARER_TOKEN`      | non défini | Token bearer requis pour accéder aux endpoints Prometheus `/metrics/*`. Laisse vide pour rendre les endpoints inatteignables de l'extérieur. |

Définir `METRICS_BEARER_TOKEN` expose deux endpoints derrière le token : `/metrics/platform` et `/metrics/convex` (les 261 métriques intégrées de Convex, qui portent désormais aussi les timings RAG et de crawl). Voir [Configuration d'observabilité](/fr/self-hosted/configuration/observability-config) pour la configuration de scrape.

## Chiffrement des secrets de fournisseur

| Nom                 | Défaut     | Description                                                                                                                                                                   |
| ------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SOPS_AGE_KEY`      | non défini | Clé secrète age inline. Chiffre `providers/*.secrets.json`. Mode par défaut après `tale init`. Plusieurs clés ne sont pas supportées en inline.                               |
| `SOPS_AGE_KEY_FILE` | non défini | Chemin vers un fichier avec une ou plusieurs clés age (une par ligne ; commentaires `#` autorisés). Obligatoire pour la rotation. S'exclut mutuellement avec la forme inline. |

Si les deux clés age ne sont pas définies, Tale stocke `providers/*.secrets.json` en JSON clair en mode 0600. Atteins ce mode seulement si le disque hôte est chiffré au repos ou si les fichiers sont produits par un outillage externe (un montage de secret Kubernetes, un template Vault). Faire tourner une clé age, c'est ajouter la nouvelle clé, réenregistrer chaque fournisseur dans l'UI, puis retirer l'ancienne. Voir [Secrets avec SOPS](/fr/self-hosted/configuration/secrets-with-sops) pour la marche complète de rotation.

La source de clé par variable d'environnement ne nécessite aucun commutateur de déploiement : des identifiants peuvent porter seulement le _nom_ d'une variable d'environnement au lieu d'une clé stockée, tant que ce nom porte le préfixe réservé `TALE_PROVIDER_KEY_`. La barrière est fail-closed — tout autre nom est rejeté, donc le champ ne peut jamais pointer sur un secret de déploiement étranger — et les noms sont plafonnés à 40 caractères. Définis la variable ici ou dans ton gestionnaire de secrets pour que la plateforme et le backend Convex puissent tous deux la lire ; le mécanisme complet est documenté dans [Fournisseurs](/fr/self-hosted/configuration/providers). Un identifiant de type courtier d'abonnement dispose d'un second espace de noms, distinct, pour le secret que Tale présente **au courtier** : ce champ accepte un nom de variable d'environnement sous le préfixe réservé `TALE_TOKEN_SOURCE_`, plafonné à 60 caractères. Les deux préfixes restent séparés à dessein — un secret de courtier n'est pas une clé API de fournisseur, et aucun des deux champs ne peut nommer une variable hors de son propre espace de noms.

## Applications OAuth des connecteurs

Les connecteurs OAuth (Gmail, Google Drive, Outlook, Teams, Slack, …) résolvent leur application fournisseur d’abord par organisation : une app configurée sous **Paramètres > Connectors > Apps OAuth** gagne pour cette organisation. L’environnement fournit la valeur par défaut du déploiement en dessous (et reste la seule source pour Slack, dont la vérification de signature des événements s’exécute avant qu’aucune organisation ne soit connue). Pour chaque slug de connecteur :

| Nom                                    | Défaut | Description                                                                                                               |
| -------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| `CONNECTOR_OAUTH_<SLUG>_CLIENT_ID`     | unset  | Identifiant client OAuth pour ce connecteur. Slug en majuscules, tirets remplacés par des tirets bas (`gmail` → `GMAIL`). |
| `CONNECTOR_OAUTH_<SLUG>_CLIENT_SECRET` | unset  | Secret client correspondant.                                                                                              |

Enregistre `${SITE_URL}${BASE_PATH}/api/connectors/oauth2/callback` sur l’application fournisseur. Détails : [Connectors (développement)](/fr/develop/connectors).

## Import cloud Knowledge (Documents)

Les autorisations OneDrive / Google Drive par utilisateur pour **Connaissances → Documents** sont distinctes des connectors d’organisation et de la connexion. Ici aussi, une app d’organisation configurée sous **Paramètres > Connectors > Apps OAuth** prime — l’entrée **google-drive** est partagée avec la voie connector, et **OneDrive / SharePoint (import de connaissances)** a sa propre entrée ; les chaînes ci-dessous s’appliquent partout où l’organisation n’en a pas configuré. Enregistre cette URI de redirection sur l’app Microsoft (ou Google) :

`${SITE_URL}${BASE_PATH}/api/cloud-import/oauth2/callback`

Résolution des identifiants pour OneDrive (premier match gagne) :

| Nom                                            | Description                                   |
| ---------------------------------------------- | --------------------------------------------- |
| `CLOUD_IMPORT_MICROSOFT_CLIENT_ID` / `_SECRET` | App dédiée à l’import Knowledge (préférée).   |
| `CLOUD_IMPORT_MICROSOFT_TENANT_ID`             | ID d’annuaire (tenant) de cette app.          |
| `AUTH_MICROSOFT_ENTRA_ID_ID` / `_SECRET`       | App de connexion Microsoft.                   |
| `AUTH_MICROSOFT_ENTRA_ID_TENANT_ID`            | ID d’annuaire (tenant) de l’app de connexion. |

Les inscriptions d’app Entra mono-tenant exigent une URL d’autorisation propre au tenant — `/common` échoue avec AADSTS50194. Définis l’ID de tenant (ou `organizations` / `common` pour une app multi-tenant). S’il est absent, Tale reprend le tenant de l’issuer SSO Entra de l’organisation s’il est configuré.

L’écran de consentement Microsoft demande Graph **Files.Read** et **Sites.Read.All** (liste/téléchargement OneDrive et SharePoint), **User.Read** (libellé du compte) et **offline_access** (jeton de rafraîchissement pour la sync). Cette autorisation est intentionnelle et par utilisateur — elle n’est pas attachée à la connexion à Tale.

Google Drive utilise uniquement une app dédiée (pas de repli sur l’app de connexion) :

| Nom                                               | Description                          |
| ------------------------------------------------- | ------------------------------------ |
| `CLOUD_IMPORT_GOOGLE_DRIVE_CLIENT_ID` / `_SECRET` | App d’import Google Drive Knowledge. |

Enregistre la même URI de callback cloud-import sur le client OAuth Google. Le consentement demande **drive.readonly** et **userinfo.email**.

## Drapeaux de fonctionnalité

Bascules optionnelles pour des fonctionnalités non activées par défaut. Chaque drapeau active ou désactive une fonctionnalité au boot ; basculer demande un redémarrage du conteneur plateforme.

| Nom                             | Défaut     | Description                                                                                                                                                                          |
| ------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TRUSTED_HEADERS_ENABLED`       | `false`    | Active le mode auth par trusted headers (identité fournie par le reverse proxy).                                                                                                     |
| `FILE_EVENTS_ENABLED`           | `false`    | Active les événements de surveillance de fichiers pour le connector OneDrive-sync.                                                                                                   |
| `TALE_DEPLOYMENT_CONFIG_ADMINS` | non défini | Allowlist de courriels (séparés par des virgules) des opérateurs autorisés à modifier la résidence des données du déploiement. Vide/non défini = lecture seule pour tous les admins. |

## Réglage du retrieval RAG

Réglages optionnels pour la recherche dans la base de connaissances. Le chemin RAG en in-process (node-actions Convex) re-note les résultats avec un cross-encoder quand le re-ranking est activé. Tous portent le préfixe `RAG_` et sont lus par les conteneurs `platform` et `convex` au boot ; après un changement, lance `docker compose restart platform convex` pour qu'il prenne effet.

| Nom                          | Défaut                                 | Description                                                                                                                                                                                  |
| ---------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RAG_RERANKING_ENABLED`      | `false`                                | Re-note les candidats fusionnés BM25 + vecteur avec un cross-encoder avant de renvoyer les résultats. Améliore la précision au prix de la latence par requête.                               |
| `RAG_RERANKING_MODEL`        | `cross-encoder/ms-marco-MiniLM-L-6-v2` | Identifiant du modèle cross-encoder transmis au fournisseur de rerank.                                                                                                                       |
| `RAG_RERANKING_PROVIDER`     | `local`                                | Doit être réglé sur `api` pour activer le re-ranking — il poste les candidats à un endpoint `/rerank` externe (compatible Cohere/Jina). `local` n'est plus supporté et échoue tout de suite. |
| `RAG_RERANKING_TOP_K`        | `10`                                   | Nombre maximal de résultats que le reranker renvoie. La réponse ne dépasse jamais le `top_k` de la requête.                                                                                  |
| `RAG_RERANKING_CANDIDATES`   | `30`                                   | Taille du pool de candidats fourni au reranker. Un pool plus large améliore la qualité de re-notation et coûte proportionnellement plus de temps par requête.                                |
| `RAG_RERANKING_API_BASE_URL` | non défini                             | URL de base du fournisseur de rerank ; la plateforme appelle `{base_url}/rerank`. Obligatoire quand le re-ranking est activé.                                                                |
| `RAG_RERANKING_API_KEY`      | non défini                             | Token Bearer envoyé à l'endpoint de rerank externe. Laisse-le non défini pour les endpoints sans authentification.                                                                           |

Le re-ranking est livré désactivé parce qu'il ajoute de la latence par requête et dépend d'un endpoint externe. Active-le — en réglant `RAG_RERANKING_PROVIDER=api` et en pointant `RAG_RERANKING_API_BASE_URL` vers un service de rerank hébergé — quand la précision du retrieval compte plus que le temps de réponse. Il n'y a aucun modèle en in-process à télécharger ou à mettre en cache ; le re-ranking désactivé, la recherche renvoie le classement hybride BM25 + vecteur simple.

## Sessions

| Nom                            | Défaut     | Description                                                                                                                                                                                                           |
| ------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_IDLE_TIMEOUT_MINUTES` | non défini | **Optionnel.** Déconnecte une session après ce nombre de minutes d'inactivité (`1`–`1440`). La fenêtre glisse à chaque activité et est appliquée côté serveur — sessions e-mail/mot de passe, SSO et trusted headers. |

Laisse-le non défini pour conserver la durée de session par défaut. Si défini, une session inactive expire côté serveur une fois la fenêtre écoulée, tandis qu'une session active continue de glisser à chaque requête. Les Administrateurs d'organisation peuvent raccourcir la fenêtre effective par organisation — jamais l'allonger au-delà de ce plafond — via la [politique de gouvernance du délai d'inactivité de session](/fr/platform/admin/governance/policies-and-limits) ; les sessions inactives sous cette politique sont révoquées par une passe qui tourne environ toutes les cinq minutes.

## Ingestion de liens vidéo (yt-dlp)

Quand Tale ingère un lien vidéo, il récupère sa transcription pour l'agent. YouTube bloque l'accès automatisé depuis les IP de centres de données/serveurs, ce qui peut échouer sur un déploiement cloud. Le déploiement embarque par défaut un fournisseur de PO tokens câblé d'origine (voir [Ingestion vidéo](/fr/self-hosted/configuration/video-ingestion) pour le tableau complet) ; les options ci-dessous sont des surcharges et des escalades facultatives. Aucune ne garantit un contournement — une IP de sortie propre est le levier le plus important. Lues par le conteneur `convex` et réévaluées à chaque ingestion, donc une modification prend effet sans redémarrage.

| Nom                              | Défaut                                     | Description                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VIDEO_INGEST_PROXY_URL`         | non défini                                 | Acheminer la sortie de yt-dlp via un proxy (une IP résidentielle/FAI fonctionne le mieux ; les proxys de centre de données sont généralement signalés aussi). Schémas : `http`, `https`, `socks4`, `socks4a`, `socks5`, `socks5h` — privilégie `socks5h://` pour que le DNS soit résolu au niveau du proxy.                                                |
| `VIDEO_INGEST_POT_PROVIDER_URL`  | `http://bgutil-provider:4416` (intégré)    | URL de base du fournisseur de PO tokens qui fournit les tokens GVS levant le mur anti-bot de YouTube. Par défaut, le sidecar compose `bgutil-provider` quand le plugin intégré est présent — à définir uniquement pour pointer vers un fournisseur sur un autre hôte.                                                                                      |
| `VIDEO_INGEST_FETCH_POT`         | `always` dès qu'un fournisseur est branché | Quand yt-dlp demande des PO tokens au fournisseur (`never`/`auto`/`always`). Le `auto` de yt-dlp n'en demande jamais pour la requête player — précisément là où le mur anti-bot frappe —, Tale passe donc à `always` dès qu'un fournisseur est présent. `never` contourne un fournisseur défaillant.                                                       |
| `VIDEO_INGEST_YTDLP_PLUGIN_DIRS` | `/opt/yt-dlp/plugins` (intégré)            | Répertoire depuis lequel yt-dlp charge les plugins — chaque plugin imbriqué un niveau plus bas (`<dir>/<nom>/yt_dlp_plugins/…`). Par défaut, le répertoire de plugins bgutil intégré quand il est présent ; ne le remplace que pour ajouter tes propres plugins.                                                                                           |
| `VIDEO_INGEST_COOKIES_FILE`      | non défini                                 | Chemin vers un fichier de cookies Netscape. Des cookies invités issus d'une session privée augmentent la limite de débit sans risque de bannissement ; des cookies de compte débloquent le contenu restreint mais risquent le compte.                                                                                                                      |
| `VIDEO_INGEST_PLAYER_CLIENT`     | `default,tv_simply`                        | Liste de repli des clients de lecture YouTube, séparés par des virgules. Quand un fournisseur de PO tokens est branché, la valeur par défaut s'élargit à `default,mweb,tv_simply` (mweb exige un token GVS) ; définis-la explicitement pour forcer une liste.                                                                                              |
| `VIDEO_INGEST_PO_TOKEN`          | non défini                                 | PO token défini manuellement (`CLIENT.CONTEXT+TOKEN`). Surtout pour les tests — les tokens sont liés à l'ID de la vidéo et éphémères ; privilégie le fournisseur.                                                                                                                                                                                          |
| `VIDEO_INGEST_IMPERSONATE`       | non défini                                 | Cible d'imitation TLS/JA3 du navigateur (p. ex. `safari`). Nécessite `curl_cffi` dans l'image ; à laisser non défini sauf disponibilité connue.                                                                                                                                                                                                            |
| `VIDEO_INGEST_BIN_DIR`           | non défini                                 | Répertoire ajouté en tête du `PATH` du processus enfant yt-dlp/ffmpeg, pour qu'un `yt-dlp` auto-provisionné (et son runtime Deno) installé hors des répertoires bin intégrés soit trouvé en premier. L'image `convex` intègre yt-dlp dans le `PATH`, donc laisse-le non défini là ; définis-le sur un hôte ou une machine de dev avec sa propre toolchain. |
| `VIDEO_INGEST_FFMPEG_LOCATION`   | `/usr/bin/ffmpeg`                          | Chemin absolu vers le ffmpeg que yt-dlp utilise pour la post-production (conversion des sous-titres, extraction audio). À surcharger quand ffmpeg vit ailleurs — p. ex. le `/opt/homebrew/bin/ffmpeg` de Homebrew sur une machine de dev macOS.                                                                                                            |

Aucune de ces options ne garantit le succès face à la détection adaptative de YouTube. Les vidéos publiques ordinaires, les plateformes moins agressives ou un déploiement à IP résidentielle/auto-hébergé fonctionnent généralement sans elles.

## Où cela s'inscrit

Les variables ici sont la surface de contact de l'opérateur ; la surface UI qui en consomme la plupart vit sous [Plateforme administration](/fr/platform/admin/overview). Les clés de fournisseur sont la moitié-et-moitié : les clés elles-mêmes vivent dans `providers/*.secrets.json`, mais l'UI sous **Paramètres > Fournisseurs IA** est ainsi que tu les ajoutes et les fais tourner en pratique. La lecture suivante à mettre en file est [Fournisseurs](/fr/self-hosted/configuration/providers) — elle couvre les fichiers de connecteurs livrés et les variables réservées qui portent les clés de fournisseur.
