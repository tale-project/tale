<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo-dark.svg">
  <img alt="Tale" src=".github/assets/logo-light.svg" width="150">
</picture>

### L'orchestrateur pour agents IA

Connecte **OpenClaw**, **Hermes Agent**, **Claude Code**, **Codex**, **Cursor**, **Gemini CLI**, **OpenCode** et **Pi**.<br/>
Mets en commun leurs connaissances, délègue des tâches et construis ton essaim d'agents.

[![Licence : MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-tale-0a0a0a.svg)](https://tale.dev/docs/fr)
[![Auto-hébergé](https://img.shields.io/badge/self--hosted-Docker-2496ed.svg)](https://tale.dev/docs/fr/self-hosted/install/quickstart)

[Démarrage rapide](#démarrage-rapide) · [Que peux-tu faire ?](#que-peux-tu-faire) · [Commandes](#référence-des-commandes) · [Documentation](#documentation) · [Contribuer](#contribuer)

**Lis ceci en :** [English](README.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

</div>

---

Tale est une **plateforme IA auto-hébergée** qui transforme les agents et CLI que ton équipe utilise déjà en une force de travail coordonnée. Donne-leur une base de connaissances partagée, branche tes outils et tes intégrations, et délègue le travail entre eux — agents, automatisations et un inbox unifié, le tout sur ta propre infrastructure. Installe le CLI, puis deux commandes suffisent pour démarrer.

**Choisis ta voie :**

- **Essayer Tale en local** — installe la CLI et lance deux commandes sur ta propre machine. Commence par [Démarrage rapide](#démarrage-rapide) ci-dessous.
- **Utiliser Tale Cloud** — laisse Tale exploiter la stack, inscris-toi et embarque ton équipe. Commence par [Onboarding Cloud](https://tale.dev/docs/fr/cloud/onboarding).
- **Contribuer** — fais tourner Tale depuis le code source et renvoie une modification. Commence par [Configuration contributeur](docs/fr/develop/contributor-setup.md).

## Démarrage rapide

Fais tourner Tale sur ta machine — installe la CLI, puis deux commandes : échafaude un projet, démarre-le. La CLI installe Docker s'il est absent et génère chaque secret pour toi, donc il n'y a rien à installer au préalable ni à éditer à la main.

**Prérequis pour un essai local : aucun.** L'installeur met en place Docker pour toi, et `tale init` génère chaque secret — tu n'as rien à apporter pour faire tourner la stack. Une [clé API OpenRouter](https://openrouter.ai) (ou tout fournisseur compatible OpenAI) est optionnelle et n'est nécessaire qu'avant qu'un agent puisse répondre : tu l'ajoutes dans l'app après l'inscription, dans l'assistant de configuration ou sous **Paramètres → Fournisseurs IA**. `tale init` ne la demande pas.

> **Windows avec backend Hyper-V :** vérifie que ton lecteur de projet est partagé dans Docker Desktop Settings > Resources > File Sharing. Le backend WSL2 (par défaut) ne demande aucune configuration supplémentaire.

### 1. Installer le CLI

**Linux / macOS :**

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

**Windows (PowerShell) :**

```powershell
irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

### 2. Créer un projet

```bash
tale init my-project
cd my-project
```

`tale init` écrit des valeurs par défaut localhost avec un certificat auto-signé et génère chaque secret de sécurité — le domaine se choisit plus tard, à `tale deploy`. Il demande une seule fois si les agents peuvent lancer Docker dans leurs sandboxes (par défaut : non), échafaude des configs d'exemple sous `default/` et écrit `AGENTS.md` plus un pointeur `CLAUDE.md`, avec le code source de la plateforme extrait dans `.tale/reference/` pour que les éditeurs IA puissent créer et modifier des configs en connaissant la plateforme. Le même projet fonctionne pour un essai local comme pour un vrai déploiement.

### 3. Démarrer Tale

```bash
tale dev
```

Dès que tu vois « Tale is running », `tale dev` ouvre https://localhost (ou ton domaine configuré) dans ton navigateur — s'il ne peut pas, il imprime l'URL à visiter.

> **Note :** ton navigateur affichera un avertissement de certificat pour les certificats auto-signés. C'est sûr de l'accepter.

Pour les instructions détaillées d'installation, voir le [démarrage rapide auto-hébergé](https://tale.dev/docs/fr/self-hosted/install/quickstart).

## Que peux-tu faire ?

| Objectif                            | Comment                                                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------------------- |
| **Créer des agents personnalisés**  | Modifier les fichiers JSON dans `agents/` — instructions, outils et modèles                  |
| **Construire des automatisations**  | Modifier les fichiers JSON dans `workflows/` — déclencheurs, conditions, boucles, étapes IA  |
| **Ajouter des intégrations**        | Modifier les fichiers dans `integrations/` — APIs REST, bases SQL, connecteurs sur mesure    |
| **Construire des configs avec IA**  | Ouvrir le projet dans ton éditeur IA — `AGENTS.md` et `.tale/reference/` portent les schémas |
| **Discuter avec l'IA**              | Intégré dans la plateforme — disponible immédiatement                                        |
| **Bâtir une base de connaissances** | Téléverser des documents, crawler des sites, gérer produits et clients                       |
| **Gérer les conversations**         | Inbox unifié pour les conversations clients avec réponses assistées par IA                   |
| **Voir les données backend**        | Lancer `tale convex admin` et ouvrir le Convex Dashboard                                     |

Tous les fichiers dans `agents/`, `workflows/` et `integrations/` sont rechargés à chaud — modifie et vois les changements immédiatement.

## Référence des commandes

### Développement

```bash
tale init [directory]              # Créer un nouveau projet avec des configs d'exemple (sans Docker)
tale dev                           # Démarrer tous les services localement
tale dev --detach                  # Démarrer en arrière-plan
tale dev --port 8443               # Utiliser un port HTTPS personnalisé
tale update                        # Mettre à jour le CLI + synchroniser les fichiers du projet (puis `tale deploy` ; le CLI se réaligne automatiquement)
tale convex admin                  # Générer une clé admin du Convex Dashboard
tale config                        # Gérer la configuration du CLI
```

### Production

```bash
tale deploy                        # Déploiement blue-green sans downtime de la version CLI courante
tale status                        # Afficher le statut du déploiement
tale logs <service>                # Voir les logs d'un service
tale logs platform -f              # Suivre les logs en direct
tale backup                        # Snapshot de tous les volumes de données
tale restore                       # Lister les snapshots / en restaurer un (stack arrêté)
tale rollback                      # Revenir à la version patch précédente
tale cleanup                       # Supprimer les conteneurs inactifs
tale reset --force                 # Supprimer tous les conteneurs
```

Voir la [référence du CLI](tools/cli/README.md) pour toutes les options et flags. Mettre à jour un déploiement existant tient en deux commandes : `tale update` fait passer le CLI et tes fichiers de projet à la nouvelle version, puis `tale deploy` fait tourner les conteneurs. Le runbook complet se trouve dans [Mises à niveau auto-hébergées](https://tale.dev/docs/fr/self-hosted/operate/upgrades).

## Déployer en production

```bash
tale deploy
```

Le CLI gère des déploiements blue-green sans downtime avec health-checks et rollback automatiques. Pour l'installation production complète (configuration reverse proxy et déploiement en sous-chemin), voir le [guide de déploiement production](https://tale.dev/docs/fr/self-hosted/install/linux-server).

## Options d'authentification

Tale utilise par défaut l'authentification par mot de passe. Le premier utilisateur crée le compte propriétaire ; tous les autres sont créés par un admin. Pour activer le login en self-service, branche un SSO ou des trusted headers via Microsoft Entra ID — voir l'[aperçu des intégrations](https://tale.dev/docs/fr/platform/integrations/overview) pour le connecteur Microsoft 365 qui alimente à la fois la synchro de documents et le SSO.

- **Microsoft Entra ID (SSO) :** single sign-on avec Microsoft 365 / Azure AD avec provisioning automatique
- **Trusted headers :** pour les déploiements derrière un reverse proxy authentifiant (Authelia, Authentik, oauth2-proxy)

## Développement

Pour le développement local (hors Docker) :

### Prérequis

- **Bun** : 1.3.x ou supérieur ([instructions d'installation](https://bun.sh/docs/installation))
- **Python** : 3.12.x (pour les scripts Python des skills fournis, p. ex. le skill PPTX)
- **uv** : gestionnaire de paquets Python ([instructions d'installation](https://github.com/astral-sh/uv))

### Commandes de développement

```bash
bun install                      # Installer les dépendances
bun run dev                      # Démarrer les serveurs de dev (lance un Convex local)
bun run typecheck                # Vérification des types
bun run lint                     # Linting
bun run test                     # Lancer les tests
bun run build                    # Build de tous les services
```

#### Optionnel : mode hybride contre un Convex en conteneur

Tu peux lancer Vite localement contre le conteneur `convex` dédié au lieu de spawner `bunx convex dev` :

```bash
docker compose up convex                        # dans un terminal
CONVEX_EXTERNAL=true bun run dev                # dans un autre (CONVEX_URL optionnel)
```

Pratique quand tu veux des reloads Vite rapides mais un backend Convex stable qui reflète la production. Définis `CONVEX_URL` si ton conteneur expose Convex sur un host/port non-standard.

### Problèmes connus

- **Vulnérabilité de sécurité xlsx** : le projet utilise xlsx@0.18.5, qui a des vulnérabilités connues (Prototype Pollution et ReDoS). C'est la dernière version disponible et aucun correctif n'est encore publié. Le paquet sert à parser les fichiers Excel dans la fonctionnalité documents.
- **Avertissement ENVIRONMENT_FALLBACK** : pendant le build de la plateforme, tu peux voir une erreur `ENVIRONMENT_FALLBACK`. C'est un avertissement spécifique à Convex qui n'empêche pas le build de réussir.

## Documentation

Le site de doc et l'UI de la plateforme tournent en trois langues de base (`en`, `de`, `fr`) plus des variantes régionales lorsque la formulation locale diffère (aujourd'hui : `de-CH` ; le chargeur détecte tout nouveau bundle `xx-YY` automatiquement). Les variantes ne portent que les chaînes qui diffèrent de leur base ; les clés manquantes retombent via la base jusqu'à l'anglais. Démarre par [tale.dev/docs/fr](https://tale.dev/docs/fr) pour choisir un point d'entrée par persona (source : [`docs/fr/index.md`](docs/fr/index.md)).

<details>
<summary><strong>Pour les utilisateurs au quotidien</strong></summary>

- **[Aperçu du chat](https://tale.dev/docs/fr/platform/chat/overview)** — les quatre parties de l'écran, où creuser
- **[Bases du chat IA](https://tale.dev/docs/fr/platform/chat/basics)** — composer, agents, sélecteur de modèles, streaming, citations
- **[Recherche approfondie](https://tale.dev/docs/fr/platform/chat/deep-research)** — l'agent Chercheur avec plan en direct et rapport PDF
- **[Pièces jointes](https://tale.dev/docs/fr/platform/chat/attachments)** — fichiers dans le chat, RAG vs tel quel
- **[Chats partagés](https://tale.dev/docs/fr/platform/chat/shared-threads)** — partager un chat avec l'organisation, dupliquer en un chat à toi
- **[Approbations](https://tale.dev/docs/fr/platform/approvals/concepts)** — relire les actions IA

</details>

<details>
<summary><strong>Pour les bâtisseurs (agents, automatisations, intégrations)</strong></summary>

- **[Concepts d'agent](https://tale.dev/docs/fr/platform/agents/concepts)** — le modèle à quatre boutons derrière chaque agent
- **[Créer un agent](https://tale.dev/docs/fr/platform/agents/create)** — assistants IA spécialisés de bout en bout
- **[Outils d'agent](https://tale.dev/docs/fr/platform/agents/tools)** — les familles d'outils intégrées
- **[Projets](https://tale.dev/docs/fr/platform/projects/overview)** — espace de travail partagé pour fichiers, chats et agents de Projet
- **[Concepts d'automatisation](https://tale.dev/docs/fr/platform/automations/concepts)** — workflows, déclencheurs, portes d'approbation
- **[Aperçu des intégrations](https://tale.dev/docs/fr/platform/integrations/overview)** — Slack, Teams, Gmail, Outlook, Microsoft 365, Google Drive, Confluence, WebDAV, GitHub, Shopify, Tavily, MCP
- **[Modèles livrés en standard](https://tale.dev/docs/fr/platform/models)** — OpenRouter comme unique fournisseur par défaut, plus les listes de modèles livrées

</details>

<details>
<summary><strong>Pour les admins</strong></summary>

- **[Membres et rôles](https://tale.dev/docs/fr/platform/admin/members-and-roles)** — gestion des utilisateurs et matrice de permissions
- **[Modèles livrés en standard](https://tale.dev/docs/fr/platform/models)** — quels modèles les défauts embarquent ; échanger ou ajouter un fournisseur
- **[Aperçu des intégrations](https://tale.dev/docs/fr/platform/integrations/overview)** — connecteurs tiers, serveurs MCP, configurations personnalisées
- **[Cloud trust et conformité](https://tale.dev/docs/fr/cloud/trust-and-compliance)** — cadres, responsabilité partagée, preuves à remettre aux auditeurs

</details>

<details>
<summary><strong>Pour les opérateurs</strong></summary>

- **[Aperçu auto-hébergé](https://tale.dev/docs/fr/self-hosted/overview)** — architecture et services
- **[Démarrage rapide](https://tale.dev/docs/fr/self-hosted/install/quickstart)** — installation sur un seul hôte en vingt minutes
- **[Déploiement production](https://tale.dev/docs/fr/self-hosted/install/linux-server)** — serveur Linux avec TLS, pare-feu, utilisateur non-root
- **[Référence Docker Compose](https://tale.dev/docs/fr/self-hosted/install/docker-compose-reference)** — fichier de base et overlays
- **[CLI Tale](tools/cli/README.md)** — référence du CLI
- **[Référence d'environnement](https://tale.dev/docs/fr/self-hosted/configuration/environment-reference)** — toutes les variables d'environnement
- **[Architecture des conteneurs](https://tale.dev/docs/fr/self-hosted/operate/container-architecture)** — sept conteneurs, qui possède quoi

</details>

<details>
<summary><strong>Pour les développeurs</strong></summary>

- **[Référence API](https://tale.dev/docs/fr/develop/api-reference)** — API REST pour les agents, le chat, les connaissances et les workflows
- **[Webhooks](https://tale.dev/docs/fr/develop/webhooks)** — webhooks de workflows et d'agents avec vérification de signature
- **[Aperçu développeur](https://tale.dev/docs/fr/develop/overview)** — la surface développeur de bout en bout

</details>

## Besoin d'aide ?

- **Logs** : `tale logs <service>` pour voir les logs d'un service
- **Health-checks** : ouvrir `{SITE_URL}/api/health`
- **Statut du déploiement** : `tale status` pour vérifier le déploiement production
- **Convex Dashboard** : `tale convex admin` pour générer une clé admin
- **Issues et discussions** : [github.com/tale-project/tale/issues](https://github.com/tale-project/tale/issues)

## Contribuer

Nouveau dans le dépôt ? [Configuration contributeur](docs/fr/develop/contributor-setup.md) est la source unique de vérité pour faire tourner le code source en local — prérequis, `bun install`, le pré-vol `bun run setup:check` et `bun run dev`. Lis [`AGENTS.md`](AGENTS.md) avant ton premier PR — c'est le contrat unique pour le style de code, la sécurité, les tests, l'i18n et la documentation à travers tous les workspaces. Le skill [`write-docs`](.agents/skills/write-docs/SKILL.md) couvre le site de doc ; le skill [`write-translations`](.agents/skills/write-translations/SKILL.md) les règles de traduction inter-langues. Lance `bun run check` (format, lint, typecheck, tests) avant d'ouvrir un PR ; le [pull request template](.github/pull_request_template.md) liste le reste de la checklist pre-merge.

---

## Historique des étoiles

[![Star History Chart](https://api.star-history.com/svg?repos=tale-project/tale&type=date&legend=top-left)](https://www.star-history.com/#tale-project/tale&type=date&legend=top-left)
