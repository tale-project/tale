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

Le CLI demande ton domaine, ta clé API et le mode TLS. Les secrets de sécurité sont générés automatiquement. Il génère aussi des fichiers de configuration pour les éditeurs IA et extrait le code source de la plateforme dans `.tale/reference/` pour que les éditeurs IA puissent créer et modifier des configs en connaissant la plateforme. Voir [Développement assisté par IA](docs/fr/develop/ai-assisted-development.md).

### 3. Démarrer Tale

```bash
tale start
```

Ouvre https://localhost (ou ton domaine configuré) dès que tu vois « Tale Platform is running! »

> **Note :** ton navigateur affichera un avertissement de certificat pour les certificats auto-signés. C'est sûr de l'accepter.

Pour les instructions détaillées d'installation, voir le [Guide de démarrage](docs/fr/platform/member/overview.md).

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
tale start --fresh                 # Re-seeder les configs intégrées
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

Voir la [référence du CLI](tools/cli/README.md) pour toutes les options et flags. Les migrations de données en attente sont détectées et appliquées automatiquement au prochain `tale start` ou `tale deploy`.

## Déployer en production

```bash
tale deploy
```

Le CLI gère des déploiements blue-green sans downtime avec health-checks et rollback automatiques. Pour l'installation production complète (configuration reverse proxy et déploiement en sous-chemin), voir le [guide de déploiement production](docs/fr/self-hosted/install/linux-server.md).

## Options d'authentification

Tale utilise par défaut l'authentification par mot de passe. Le premier utilisateur crée le compte propriétaire ; tous les autres sont créés par un admin. Pour activer le login en self-service, branche un SSO ou des trusted headers. Détails complets dans le [guide d'authentification](docs/fr/self-hosted/admin/authentication.md).

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

Le site de doc est publié en trois langues (`en`, `de`, `fr`) avec une couverture complète. L'UI de la plateforme elle-même est en six (`en`, `de`, `de-AT`, `de-CH`, `fr`, `fr-CH`) — les variantes régionales partagent la doc de leur langue de base. Démarre par [`docs/index.md`](docs/index.md) pour choisir un point d'entrée par persona.

### Pour les utilisateurs au quotidien

- **[Démarrage](docs/fr/platform/member/overview.md)** — installer Tale et ouvrir l'app
- **[Bases du chat IA](docs/fr/platform/chat/basics.md)** — discuter, joindre des fichiers, choisir un agent
- **[Base de connaissances](docs/fr/platform/workspace/knowledge-base.md)** — documents et sites web
- **[Conversations](docs/fr/platform/workspace/conversations.md)** — inbox client
- **[Approbations](docs/fr/platform/workspace/approvals.md)** — relire les actions IA
- **[Tes préférences](docs/fr/platform/member/preferences.md)** — mot de passe, langue, thème

### Pour les bâtisseurs (agents, automatisations, intégrations)

- **[Ce que tu peux construire](docs/fr/platform/developer/overview.md)** — orientation pour Editor/Developer
- **[Créer un agent](docs/fr/platform/agents/create.md)** — assistants IA spécialisés
- **[Workflows](docs/fr/platform/automations/workflows.md)** — automatisations multi-étapes
- **[Données structurées](docs/fr/platform/knowledge/structured-data.md)** — produits, clients, fournisseurs
- **[Vue des intégrations](docs/fr/platform/integrations/overview.md)** — REST, SQL, e-mail, OneDrive

### Pour les admins

- **[Membres et rôles](docs/fr/platform/admin/members-and-roles.md)** — gestion des utilisateurs et matrice de permissions
- **[Authentification](docs/fr/self-hosted/admin/authentication.md)** — mot de passe, SSO, trusted headers
- **[Fournisseurs IA](docs/fr/platform/admin/providers.md)** — configurer les modèles dans l'UI admin
- **[Gouvernance](docs/fr/platform/admin/governance.md)** — budgets, rétention, détection PII, journaux d'audit
- **[Analytics d'usage](docs/fr/platform/admin/usage-analytics.md)** — reporting tokens et coûts dans le temps

### Pour les opérateurs

- **[Vue de la plateforme](docs/fr/self-hosted/overview.md)** — architecture et services
- **[Déploiement production](docs/fr/self-hosted/install/linux-server.md)** — Docker Compose, déploiements zero-downtime, reverse proxy
- **[CLI Tale](tools/cli/README.md)** — référence du CLI
- **[Référence d'environnement](docs/fr/self-hosted/configuration/environment-reference.md)** — toutes les variables d'environnement
- **[Exploitation](docs/fr/self-hosted/operate/observability/operations.md)** — monitoring, suivi des erreurs, sauvegardes
- **[Dépannage](docs/fr/self-hosted/operate/observability/troubleshooting.md)** — problèmes courants

### Pour les développeurs

- **[Référence API](docs/fr/develop/api-reference.md)** — API REST pour RAG, Crawler et Platform
- **[Webhooks](docs/fr/develop/webhooks.md)** — webhooks de workflows et d'agents avec vérification de signature
- **[Développement assisté par IA](docs/fr/develop/ai-assisted-development.md)** — configurer agents/workflows dans des éditeurs IA
- **[Contribuer Docker](docs/fr/develop/contributing-docker.md)** — modifier les Dockerfiles et lancer les tests conteneurs

## Besoin d'aide ?

- **Logs** : `tale logs <service>` pour voir les logs d'un service
- **Health-checks** : ouvrir `{SITE_URL}/api/health`
- **Statut du déploiement** : `tale status` pour vérifier le déploiement production
- **Convex Dashboard** : `tale convex admin` pour générer une clé admin
- **Issues et discussions** : [github.com/tale-project/tale/issues](https://github.com/tale-project/tale/issues)

## Contribuer

Lis [`AGENTS.md`](AGENTS.md) avant ton premier PR — c'est le contrat unique pour le style de code, la sécurité, les tests, l'i18n et la documentation à travers tous les workspaces. [`docs/AGENTS.md`](docs/AGENTS.md) couvre le site de doc Mintlify ; [`.agents/TERMINOLOGY.md`](.agents/TERMINOLOGY.md) les règles de traduction inter-langues. Lance `bun run check` (format, lint, typecheck, tests) avant d'ouvrir un PR ; le [pull request template](.github/pull_request_template.md) liste le reste de la checklist pre-merge.

---

## Historique des étoiles

[![Star History Chart](https://api.star-history.com/svg?repos=tale-project/tale&type=date&legend=top-left)](https://www.star-history.com/#tale-project/tale&type=date&legend=top-left)
