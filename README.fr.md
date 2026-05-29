# Tale

> **Lis ceci en :** [English](README.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

Construis des applications IA en quelques minutes, pas en quelques mois.

Tale est une plateforme IA auto-hébergée avec des agents personnalisés, une base de connaissances, l'automatisation de workflows, des intégrations et un inbox unifié. Installe le CLI et lance une seule commande pour démarrer.

## Démarrage rapide

**Prérequis :** [Docker Desktop](https://www.docker.com/products/docker-desktop) (v24+) et une [clé API OpenRouter](https://openrouter.ai).

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

Le CLI demande ton domaine, ta clé API et le mode TLS. Les secrets de sécurité sont générés automatiquement. Il génère aussi des fichiers de configuration pour les éditeurs IA et extrait le code source de la plateforme dans `.tale/reference/` pour que les éditeurs IA puissent créer et modifier des configs en connaissant la plateforme.

### 3. Démarrer Tale

```bash
tale start
```

Ouvre https://localhost (ou ton domaine configuré) dès que tu vois « Tale Platform is running! »

> **Note :** ton navigateur affichera un avertissement de certificat pour les certificats auto-signés. C'est sûr de l'accepter.

Pour les instructions détaillées d'installation, voir le [démarrage rapide auto-hébergé](docs/fr/self-hosted/install/quickstart.md).

## Que peux-tu faire ?

| Objectif                            | Comment                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| **Créer des agents personnalisés**  | Modifier les fichiers JSON dans `agents/` — instructions, outils et modèles                 |
| **Construire des automatisations**  | Modifier les fichiers JSON dans `workflows/` — déclencheurs, conditions, boucles, étapes IA |
| **Ajouter des intégrations**        | Modifier les fichiers dans `integrations/` — APIs REST, bases SQL, connecteurs sur mesure   |
| **Construire des configs avec IA**  | Ouvrir le projet dans Claude Code, Cursor, Copilot ou Windsurf — l'IA connaît tes schémas   |
| **Discuter avec l'IA**              | Intégré dans la plateforme — disponible immédiatement                                       |
| **Bâtir une base de connaissances** | Téléverser des documents, crawler des sites, gérer produits et clients                      |
| **Gérer les conversations**         | Inbox unifié pour les conversations clients avec réponses assistées par IA                  |
| **Voir les données backend**        | Lancer `tale convex admin` et ouvrir le Convex Dashboard                                    |

Tous les fichiers dans `agents/`, `workflows/` et `integrations/` sont rechargés à chaud — modifie et vois les changements immédiatement.

## Référence des commandes

### Développement

```bash
tale init [directory]              # Créer un nouveau projet avec des configs d'exemple
tale start                         # Démarrer tous les services localement
tale start --detach                # Démarrer en arrière-plan
tale start --port 8443             # Utiliser un port HTTPS personnalisé
tale upgrade                       # Mettre à jour le CLI et synchroniser les fichiers du projet
tale convex admin                  # Générer une clé admin du Convex Dashboard
tale config                        # Gérer la configuration du CLI
```

### Production

```bash
tale deploy                        # Déploiement blue-green sans downtime de la version CLI courante
tale status                        # Afficher le statut du déploiement
tale logs <service>                # Voir les logs d'un service
tale logs platform -f              # Suivre les logs en direct
tale rollback                      # Revenir à la version précédente
tale cleanup                       # Supprimer les conteneurs inactifs
tale reset --force                 # Supprimer tous les conteneurs
```

Voir la [référence du CLI](tools/cli/README.md) pour toutes les options et flags. Mettre à jour un déploiement existant nécessite une migration manuelle unique : exécute `tale migrate config-layout` puis `tale deploy --override-all -y`. Le runbook complet se trouve dans [Mises à niveau auto-hébergées](docs/fr/self-hosted/operate/upgrades.md).

## Déployer en production

```bash
tale deploy
```

Le CLI gère des déploiements blue-green sans downtime avec health-checks et rollback automatiques. Pour l'installation production complète (configuration reverse proxy et déploiement en sous-chemin), voir le [guide de déploiement production](docs/fr/self-hosted/install/linux-server.md).

## Options d'authentification

Tale utilise par défaut l'authentification par mot de passe. Le premier utilisateur crée le compte propriétaire ; tous les autres sont créés par un admin. Pour activer le login en self-service, branche un SSO ou des trusted headers via Microsoft Entra ID — voir l'[aperçu des intégrations](docs/fr/platform/integrations/overview.md) pour le connecteur Microsoft 365 qui alimente à la fois la synchro de documents et le SSO.

- **Microsoft Entra ID (SSO) :** single sign-on avec Microsoft 365 / Azure AD avec provisioning automatique
- **Trusted headers :** pour les déploiements derrière un reverse proxy authentifiant (Authelia, Authentik, oauth2-proxy)

## Développement

Pour le développement local (hors Docker) :

### Prérequis

- **Bun** : 1.3.x ou supérieur ([instructions d'installation](https://bun.sh/docs/installation))
- **Python** : 3.12.x (requis pour les services Python : rag, crawler)
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

Pour les services Python :

```bash
cd services/rag && uv sync --extra dev
cd services/crawler && uv sync --extra dev
```

### Problèmes connus

- **Vulnérabilité de sécurité xlsx** : le projet utilise xlsx@0.18.5, qui a des vulnérabilités connues (Prototype Pollution et ReDoS). C'est la dernière version disponible et aucun correctif n'est encore publié. Le paquet sert à parser les fichiers Excel dans la fonctionnalité documents.
- **Avertissement ENVIRONMENT_FALLBACK** : pendant le build de la plateforme, tu peux voir une erreur `ENVIRONMENT_FALLBACK`. C'est un avertissement spécifique à Convex qui n'empêche pas le build de réussir.

## Documentation

Le site de doc et l'UI de la plateforme tournent en trois langues de base (`en`, `de`, `fr`) plus des variantes régionales lorsque la formulation locale diffère (aujourd'hui : `de-CH` ; le chargeur détecte tout nouveau bundle `xx-YY` automatiquement). Les variantes ne portent que les chaînes qui diffèrent de leur base ; les clés manquantes retombent via la base jusqu'à l'anglais. Démarre par [`docs/fr/index.md`](docs/fr/index.md) pour choisir un point d'entrée par persona.

### Pour les utilisateurs au quotidien

- **[Aperçu du chat](docs/fr/platform/chat/overview.md)** — les quatre parties de l'écran, où creuser
- **[Bases du chat IA](docs/fr/platform/chat/basics.md)** — composer, agents, sélecteur de modèles, streaming, citations
- **[Recherche approfondie](docs/fr/platform/chat/deep-research.md)** — l'agent Chercheur avec plan en direct et rapport PDF
- **[Pièces jointes](docs/fr/platform/chat/attachments.md)** — fichiers dans le chat, RAG vs tel quel
- **[Chats partagés](docs/fr/platform/chat/shared-threads.md)** — partager un chat avec l'organisation, dupliquer en un chat à toi
- **[Approbations](docs/fr/platform/approvals/concepts.md)** — relire les actions IA

### Pour les bâtisseurs (agents, automatisations, intégrations)

- **[Concepts d'agent](docs/fr/platform/agents/concepts.md)** — le modèle à quatre boutons derrière chaque agent
- **[Créer un agent](docs/fr/platform/agents/create.md)** — assistants IA spécialisés de bout en bout
- **[Outils d'agent](docs/fr/platform/agents/tools.md)** — les familles d'outils intégrées
- **[Projets](docs/fr/platform/projects/overview.md)** — espace de travail partagé pour fichiers, chats et agents de Projet
- **[Concepts d'automatisation](docs/fr/platform/automations/concepts.md)** — workflows, déclencheurs, portes d'approbation
- **[Aperçu des intégrations](docs/fr/platform/integrations/overview.md)** — Slack, Teams, Gmail, Outlook, Microsoft 365, Google Drive, Confluence, WebDAV, GitHub, Shopify, Tavily, MCP
- **[Modèles livrés en standard](docs/fr/platform/models.md)** — OpenRouter, OpenAI, Vercel AI Gateway et les listes de modèles livrées

### Pour les admins

- **[Membres et rôles](docs/fr/platform/admin/members-and-roles.md)** — gestion des utilisateurs et matrice de permissions
- **[Modèles livrés en standard](docs/fr/platform/models.md)** — quels modèles les défauts embarquent ; échanger ou ajouter un fournisseur
- **[Aperçu des intégrations](docs/fr/platform/integrations/overview.md)** — connecteurs tiers, serveurs MCP, configurations personnalisées
- **[Cloud trust et conformité](docs/fr/cloud/trust-and-compliance.md)** — cadres, responsabilité partagée, preuves à remettre aux auditeurs

### Pour les opérateurs

- **[Aperçu auto-hébergé](docs/fr/self-hosted/overview.md)** — architecture et services
- **[Démarrage rapide](docs/fr/self-hosted/install/quickstart.md)** — installation sur un seul hôte en vingt minutes
- **[Déploiement production](docs/fr/self-hosted/install/linux-server.md)** — serveur Linux avec TLS, pare-feu, utilisateur non-root
- **[Référence Docker Compose](docs/fr/self-hosted/install/docker-compose-reference.md)** — fichier de base et overlays
- **[CLI Tale](tools/cli/README.md)** — référence du CLI
- **[Référence d'environnement](docs/fr/self-hosted/configuration/environment-reference.md)** — toutes les variables d'environnement
- **[Architecture des conteneurs](docs/fr/self-hosted/operate/container-architecture.md)** — sept conteneurs, qui possède quoi

### Pour les développeurs

- **[Référence API](docs/fr/develop/api-reference.md)** — API REST pour RAG, Crawler et Platform
- **[Webhooks](docs/fr/develop/webhooks.md)** — webhooks de workflows et d'agents avec vérification de signature
- **[Aperçu développeur](docs/fr/develop/overview.md)** — la surface développeur de bout en bout

## Besoin d'aide ?

- **Logs** : `tale logs <service>` pour voir les logs d'un service
- **Health-checks** : ouvrir `{SITE_URL}/api/health`
- **Statut du déploiement** : `tale status` pour vérifier le déploiement production
- **Convex Dashboard** : `tale convex admin` pour générer une clé admin
- **Issues et discussions** : [github.com/tale-project/tale/issues](https://github.com/tale-project/tale/issues)

## Contribuer

Lis [`AGENTS.md`](AGENTS.md) avant ton premier PR — c'est le contrat unique pour le style de code, la sécurité, les tests, l'i18n et la documentation à travers tous les workspaces. Le skill [`docs`](.agents/docs/AGENTS.md) couvre le site de doc ; le skill [`translation`](.agents/translation/AGENTS.md) les règles de traduction inter-langues. Lance `bun run check` (format, lint, typecheck, tests) avant d'ouvrir un PR ; le [pull request template](.github/pull_request_template.md) liste le reste de la checklist pre-merge.

---

## Historique des étoiles

[![Star History Chart](https://api.star-history.com/svg?repos=tale-project/tale&type=date&legend=top-left)](https://www.star-history.com/#tale-project/tale&type=date&legend=top-left)
