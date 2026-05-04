---
title: Démarrage rapide local
description: Faire tourner Tale en local avec Docker Desktop en une dizaine de minutes — pour évaluer, faire des démos ou contribuer.
---

C’est le chemin le plus rapide pour avoir une instance Tale qui tourne sur ton portable. Utilise ce démarrage rapide pour évaluer le produit, faire une démo ou développer contre la plateforme. Pour une instance publique avec TLS et upgrades sans interruption, suis plutôt le guide [déploiement en production](/fr/self-hosted/install/linux-server).

## Prérequis

| Logiciel       | Version minimale | Où l’obtenir                                   |
| -------------- | ---------------- | ---------------------------------------------- |
| Docker Desktop | 24.0+            | https://www.docker.com/products/docker-desktop |

### Obtenir une clé API

Tale utilise OpenRouter comme passerelle IA par défaut, ce qui donne accès à des centaines de modèles via une seule clé API.

1. Va sur https://openrouter.ai et crée un compte gratuit.
2. Dans ton tableau de bord, va dans **Keys** et génère une nouvelle clé API.
3. Copie la clé — tu la colleras pendant l’installation.

> **Astuce :** N’importe quel fournisseur compatible OpenAI fonctionne, y compris une instance Ollama locale. OpenRouter est la valeur par défaut recommandée pour la variété de modèles et sa tarification simple.

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

> **Épingler une version précise :** Les deux installeurs respectent la variable d’environnement `VERSION`. Sur Linux/macOS : `VERSION=0.9.0 curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash`, sur Windows : `$env:VERSION = '0.9.0'; irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex`. Les tags disponibles sont sur la [page GitHub Releases](https://github.com/tale-project/tale/releases).

Ou télécharge le binaire directement — remplace `latest` par un tag (par exemple `v0.9.0`) pour épingler :

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

> **Astuce :** `tale init` dépose aussi des fichiers de configuration pour les éditeurs IA (Claude Code, Cursor, GitHub Copilot, Windsurf) et extrait le code source de la plateforme dans `.tale/reference/`. Ouvre ton projet dans un de ces éditeurs pour créer et modifier agents, workflows et intégrations en langage naturel. Voir [AI-assisted development](/fr/develop/ai-assisted-development).

### Étape 3 : lancer Tale

```bash
tale start
```

Attends `Tale Dev v0.x.x  Ready.` Les messages de health-check pendant le démarrage sont normaux — attends la ligne `Ready` avant d’ouvrir le navigateur.

### Étape 4 : ouvrir l’application

Va sur https://localhost (ou ton domaine configuré) dans le navigateur. À la première ouverture, tu es dirigé·e vers une page d’inscription pour créer ton compte admin.

> **Avertissement de certificat auto-signé.** Le mode TLS `selfsigned` génère un certificat local, donc le navigateur affiche un avertissement de connexion non privée à la première visite. Passe outre (Chrome : **Paramètres avancés → Continuer**, Firefox : **Avancé → Accepter le risque**). Pour un déploiement public, choisis `letsencrypt` lors de `tale init` ou suis le guide [déploiement en production](/fr/self-hosted/install/linux-server).

## Usage quotidien

### Démarrer et arrêter

```bash
tale start              # démarrer tous les services
tale start --detach     # démarrer en arrière-plan
```

Pour arrêter en conservant les données :

```bash
# Arrête les conteneurs mais conserve les volumes (tes données).
# Ne jamais ajouter -v : ça supprime base, uploads et état du crawler — aucune récupération possible.
docker compose -p tale-dev down
```

Le flag `-p tale-dev` est requis parce que `tale start` utilise ce nom de projet Compose au lieu d’un `docker-compose.yml` standard.

### Upgrade

```bash
tale upgrade                       # mettre à jour vers la dernière release et synchroniser les fichiers
tale upgrade --version 0.9.0       # migrer ou redescendre vers une version précise
tale start                         # redémarrer avec la nouvelle version
```

Les ruptures de compatibilité sont signalées dans les [release notes](https://github.com/tale-project/tale/releases).

### Inspecter les données backend

```bash
tale convex admin       # génère une clé admin pour le Convex Dashboard
```

Ouvre `/convex-dashboard` dans le navigateur et colle la clé pour inspecter la base de données, voir les logs des fonctions et gérer les tâches de fond.

## Alternative : build depuis les sources

Pour contribuer à Tale ou personnaliser le code, lance depuis les sources au lieu des images pré-construites.

```bash
git clone https://github.com/tale-project/tale.git
cd tale
cp .env.example .env
```

Édite `.env` et remplace les valeurs d’exemple :

| Variable                | Comment la définir                  |
| ----------------------- | ----------------------------------- |
| `BETTER_AUTH_SECRET`    | `openssl rand -base64 32`           |
| `ENCRYPTION_SECRET_HEX` | `openssl rand -hex 32`              |
| `DB_PASSWORD`           | Un mot de passe pour la base locale |

> **Important :** `.env.example` contient des secrets d’exemple qu’il faut remplacer avant le premier démarrage.

Ensuite build et start :

```bash
docker compose up --build
```

Pour un cycle édit-reload plus rapide, utilise l’override de développement, qui monte tes répertoires sources locaux dans les conteneurs :

```bash
docker compose -f compose.yml -f compose.dev.yml up --build
```

Après modification des Dockerfiles ou dépendances, lance `bun run docker:test` pour un smoke-test du build. Le [guide Contributing Docker](/fr/develop/contributing-docker) couvre la validation d’images et les scripts de scan de vulnérabilités.
