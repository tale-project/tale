---
title: Démarrage rapide local
description: Faire tourner Tale en local avec Docker Desktop en une dizaine de minutes — pour évaluer, faire des démos ou contribuer.
---

Le démarrage rapide local est la voie la plus courte pour mettre une instance Tale en marche sur ton portable. Le CLI `tale` se charge de l'installation — une commande pour échafauder le projet, une commande pour démarrer le stack, puis un navigateur sur `https://localhost`. Sers-t'en pour évaluer le produit, faire une démo à une équipe ou bricoler sur les sources. Pour une instance publique avec un vrai TLS et des mises à niveau sans coupure, suis plutôt [Déploiement en production](/fr/self-hosted/install/linux-server).

Cette marche à suivre suppose un portable développeur avec Docker Desktop installé. Tout ce qui suit utilise le même CLI qui tourne en production — les seules différences sont le mode TLS (auto-signé par défaut) et le fait que tous les ports sont exposés en local pour la commodité du développement.

## Avant de commencer

- **Docker Desktop 24.0 ou plus récent** — installé et en marche. Les builds Linux, macOS et Windows fonctionnent tous.
- **Une clé d'API OpenRouter** — gratuite à créer sur [openrouter.ai](https://openrouter.ai). OpenRouter donne accès à des centaines de modèles via une seule clé. Tout endpoint compatible OpenAI fonctionne, y compris un serveur Ollama local ; OpenRouter est le défaut recommandé parce qu'il couvre le plus de terrain.

Récupère la clé dans la section **Keys** du tableau de bord OpenRouter une fois ton compte créé, puis garde-la à portée — `tale init` la demande pendant la configuration.

## Étape 1 — Installer le CLI

Le CLI `tale` est un binaire qui pilote le cycle de vie complet : init, start, upgrade, deploy, logs, rollback. Le script d'installation écrit dans `/usr/local/bin/tale` sur Linux et macOS :

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

Sur Windows, passe par PowerShell :

```powershell
irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

Les deux installateurs respectent une variable d'environnement `VERSION` pour épingler une release précise :

```bash
VERSION=0.9.0 curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

```powershell
$env:VERSION = '0.9.0'
irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

Les tags disponibles vivent sur la page [GitHub Releases](https://github.com/tale-project/tale/releases). Si tu préfères sauter l'installateur, le binaire est aussi disponible en téléchargement direct depuis chaque tag de release.

## Étape 2 — Créer un projet

Choisis un répertoire et fais tourner `tale init` :

```bash
tale init my-project
cd my-project
```

Le CLI demande le domaine (par défaut `localhost`), la clé OpenRouter et le mode TLS (par défaut `selfsigned`). Il écrit un fichier `.env` avec des secrets auto-générés — `BETTER_AUTH_SECRET`, `ENCRYPTION_SECRET_HEX`, `INSTANCE_SECRET` et une `SOPS_AGE_KEY` pour le mode de secrets de fournisseur chiffrés SOPS. Le répertoire du projet est la source de vérité pour cette instance : `.env` porte les secrets, `TALE_CONFIG_DIR` porte les fichiers JSON de fournisseurs, de rétention et d'agents.

`tale init` dépose aussi des fichiers de config pour les éditeurs IA (Claude Code, Cursor, GitHub Copilot, Windsurf) et extrait les sources de la plateforme dans `.tale/reference/`, pour que tu puisses ouvrir le projet dans un éditeur assisté par IA et créer agents, workflows et intégrations en langage naturel. Le schéma complet vit sur [Développement assisté par IA](/fr/develop/ai-assisted-development).

## Étape 3 — Démarrer Tale

```bash
tale start
```

Les messages de health check défilent pendant que les services montent — c'est attendu. Attends la ligne `Tale Dev v0.x.x  Ready.` avant d'ouvrir le navigateur ; le conteneur plateforme met jusqu'à trois minutes au démarrage à froid parce que l'entrypoint attend que la synchronisation d'environnement finisse et que `bunx convex deploy` pousse le jeu de fonctions avant de signaler sain.

Pour tourner en arrière-plan, passe `--detach` :

```bash
tale start --detach
```

## Étape 4 — Ouvrir l'application

Ouvre `https://localhost` (ou le domaine que tu as configuré pendant `tale init`). La première visite t'amène à une page d'inscription — le premier utilisateur à s'enregistrer devient le Propriétaire de l'instance.

Le certificat auto-signé déclenche un avertissement du navigateur à la première visite. Clique pour continuer (Chrome : **Paramètres avancés → Continuer** ; Firefox : **Paramètres avancés → Accepter le risque**) ; l'avertissement est attendu pour `TLS_MODE=selfsigned`. Pour une instance publique, choisis `letsencrypt` pendant `tale init` ou suis [Déploiement en production](/fr/self-hosted/install/linux-server).

## Workflow quotidien

`tale start` et `docker compose down` sont la paire start/stop que tu utilises le plus.

```bash
tale start                       # Démarre tous les services au premier plan
tale start --detach              # Démarre en arrière-plan
docker compose -p tale-dev down  # Arrête les conteneurs, garde les volumes (et les données)
```

Le drapeau `-p tale-dev` est requis parce que `tale start` utilise ce nom de projet compose plutôt qu'un `docker-compose.yml` par défaut. **N'ajoute jamais `-v` à la commande `down`** — ça supprime chaque volume nommé, c'est-à-dire la base, chaque fichier téléversé et l'état du crawler. Pas de récupération possible.

### Mettre à niveau

```bash
tale upgrade                       # Récupère la dernière release et synchronise les fichiers du projet
tale upgrade --version 0.9.0       # Monte ou redescend à une version précise
tale start                         # Redémarre avec la nouvelle version
```

Lis les [notes de version](https://github.com/tale-project/tale/releases) avant de mettre à niveau ; les changements cassants et les notes de migration sont signalés explicitement selon [Format des notes de version](/fr/self-hosted/operate/release-notes/format).

### Inspecter les données Convex

Le backend Convex livré embarque un tableau de bord pour inspecter les collections, les logs de fonctions et les jobs d'arrière-plan. Génère une clé admin, puis ouvre le tableau de bord :

```bash
tale convex admin
```

Ouvre `/convex-dashboard` dans ton navigateur et colle la clé. Le tableau de bord donne un accès direct en lecture et en écriture à tout dans Convex, donc garde la clé locale.

## Construire depuis les sources

Si tu veux contribuer ou customiser la plateforme, fais tourner depuis un checkout plutôt que depuis les images préconstruites. Clone le dépôt, copie l'environnement d'exemple et remplace les secrets de placeholder :

```bash
git clone https://github.com/tale-project/tale.git
cd tale
cp .env.example .env
```

Le `.env.example` livre des secrets de placeholder qui doivent être remplacés avant que le stack démarre. Génère des valeurs fraîches :

| Variable                | Génère avec                                     |
| ----------------------- | ----------------------------------------------- |
| `BETTER_AUTH_SECRET`    | `openssl rand -base64 32`                       |
| `ENCRYPTION_SECRET_HEX` | `openssl rand -hex 32`                          |
| `DB_PASSWORD`           | N'importe quel mot de passe pour la base locale |

Puis construis et démarre :

```bash
docker compose up --build
```

Pour un cycle édition-rechargement plus rapide, superpose la surcharge de développement qui monte tes sources locales dans les conteneurs :

```bash
docker compose -f compose.yml -f compose.dev.yml up --build
```

Après modification d'un `Dockerfile` ou d'une dépendance, fais tourner `bun run docker:test` pour fumer-tester le build. Le [guide Contributing Docker](/fr/develop/contributing-docker) couvre les scripts de validation d'image et d'analyse de vulnérabilités.

## Où cela sert

Ce que tu as maintenant, c'est une instance Tale en marche sur `localhost` avec des agents d'exemple, une base de connaissances d'exemple et un fournisseur IA configuré. C'est assez pour évaluer le produit, le démontrer à une équipe ou développer contre la plateforme. Ce n'est pas assez pour l'exposer à qui que ce soit en dehors de ton portable — le démarrage rapide utilise un TLS auto-signé, fait tourner chaque service sur un seul conteneur et saute la topologie blue-green qui survit aux mises à niveau sans fenêtre de maintenance.

Quand tu es prêt à mettre Tale devant des utilisateurs, [Déploiement en production](/fr/self-hosted/install/linux-server) parcourt la même installation avec un vrai domaine, un vrai TLS et la bascule blue-green. Pour le reste de la surface opérateur — observabilité, rétention, avis — [Exploitation](/fr/self-hosted/operate/observability/operations) est l'index.
