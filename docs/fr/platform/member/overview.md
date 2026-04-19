---
title: Pour commencer
description: Installe Tale et ouvre l'application — un parcours convivial pour tes 10 premières minutes.
---

C'est le chemin le plus rapide pour passer de rien à une instance Tale qui tourne. Pas besoin d'être développeur — si tu sais lancer une commande dans un terminal, tu peux suivre. Pour les setups de production auto-hébergés, va plutôt sur [Déploiement en production](/fr/self-hosted/install/linux-server).

## Prérequis

| Logiciel       | Version minimale | Où l'obtenir                                   |
| -------------- | ---------------- | ---------------------------------------------- |
| Docker Desktop | 24.0+            | https://www.docker.com/products/docker-desktop |

### Obtenir une clé API

Tale utilise OpenRouter comme passerelle IA par défaut, ce qui donne accès à des centaines de modèles via une seule clé API.

1. Va sur https://openrouter.ai et crée un compte gratuit.
2. Dans ton tableau de bord, va dans Keys et génère une nouvelle clé API.
3. Copie la clé. Tu en auras besoin pendant l'installation.

> **Astuce :** Tu peux utiliser n'importe quel fournisseur compatible OpenAI, y compris une instance Ollama locale. OpenRouter est la valeur par défaut recommandée pour la variété de modèles et sa tarification simple.

## Installation

### Étape 1 : installer le CLI

**Linux / macOS :**

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

**Windows (PowerShell) :**

```powershell
irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

Ou télécharge le binaire directement depuis [GitHub Releases](https://github.com/tale-project/tale/releases) :

```bash
# Linux
curl -fsSL https://github.com/tale-project/tale/releases/latest/download/tale_linux \
  -o /usr/local/bin/tale
chmod +x /usr/local/bin/tale
```

### Étape 2 : créer un projet

```bash
tale init my-project
cd my-project
```

Le CLI te demande ton domaine, ta clé API et le mode TLS. Les secrets de sécurité (`BETTER_AUTH_SECRET`, `ENCRYPTION_SECRET_HEX`) sont générés automatiquement.

> **Astuce :** Le CLI génère aussi des fichiers de configuration pour les éditeurs IA (Claude Code, Cursor, GitHub Copilot, Windsurf) et extrait le code source complet de la plateforme dans `.tale/reference/`. Ouvre ton projet dans l'un de ces éditeurs pour créer et modifier agents, workflows et intégrations en décrivant ce que tu veux en langage naturel. Voir [AI-assisted development](/fr/develop/ai-assisted-development).

### Étape 3 : lancer Tale

```bash
tale start
```

Attends le message Ready :

```text
Tale Dev v0.x.x  Ready.
```

> **Note :** Le numéro de version varie. Tu verras des messages de health-check pendant que les services démarrent. C'est normal. Attends le message "Ready" avant d'ouvrir ton navigateur.

### Étape 4 : ouvrir l'application

Va sur https://localhost (ou ton domaine) dans ton navigateur. À la première ouverture, tu es dirigé vers une page d'inscription pour créer ton compte admin.

## Usage quotidien

### Démarrer et arrêter

```bash
tale start              # démarrer tous les services
tale start --detach     # démarrer en arrière-plan
```

Pour arrêter tous les services en conservant tes données :

```bash
docker compose -p tale-dev down
```

Le flag `-p tale-dev` est requis parce que `tale start` crée un projet Compose nommé `tale-dev` au lieu d'utiliser un `docker-compose.yml` standard.

> **Important :** Ne lance jamais `docker compose -p tale-dev down -v`. Le flag `-v` supprime tous les volumes Docker, ce qui efface définitivement ta base de données, tes documents et l'état du crawler.

### Upgrade

```bash
tale upgrade            # mettre le CLI à jour et synchroniser les fichiers du projet
```

### Voir les données backend

```bash
tale convex admin       # générer une clé admin pour le Convex Dashboard
```

Ouvre `/convex-dashboard` dans ton navigateur et colle la clé pour inspecter la base de données, voir les logs des fonctions et gérer les tâches de fond.

## Alternative : build depuis les sources

Pour contribuer à Tale ou personnaliser le code, tu peux lancer depuis les sources au lieu des images pré-construites.

```bash
git clone https://github.com/tale-project/tale.git
cd tale
cp .env.example .env
```

Édite `.env` et remplis les valeurs requises :

| Variable                | Comment la définir                          |
| ----------------------- | ------------------------------------------- |
| `BETTER_AUTH_SECRET`    | Générer avec : `openssl rand -base64 32`    |
| `ENCRYPTION_SECRET_HEX` | Générer avec : `openssl rand -hex 32`       |
| `DB_PASSWORD`           | Choisir un mot de passe pour la base locale |

> **Important :** Le fichier `.env.example` contient des secrets d'exemple qu'il faut remplacer avant le premier démarrage.

Ensuite build et start :

```bash
docker compose up --build
```

Les temps de build varient selon le service (les 5 services se construisent en parallèle en ~3 minutes sur un système moderne). Les builds suivants sont bien plus rapides grâce au cache des couches Docker.

### Développement local avec hot-reload

Pour un cycle édit-reload plus rapide pendant le dev, utilise l'override de développement :

```bash
docker compose -f compose.yml -f compose.dev.yml up --build
```

Tes répertoires sources locaux sont montés dans les conteneurs, donc les changements sont visibles immédiatement sans reconstruire les images.

### Tests conteneurs

Après modification des Dockerfiles ou dépendances, valide tes changements :

```bash
# Smoke test : build, start, health check, teardown
bun run docker:test

# Validation d'image : labels OCI, secrets, budgets de taille
bun run docker:test:image

# Scan de vulnérabilités (nécessite Trivy)
bun run docker:test:vulnerability
```

Voir [Contributing Docker guide](/fr/develop/contributing-docker) pour plus de détails.
