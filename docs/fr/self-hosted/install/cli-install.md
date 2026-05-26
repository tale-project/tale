---
title: Installer la CLI tale
description: Installer la CLI tale sur macOS, Linux ou Windows — et la configurer contre ton instance auto-hébergée pour les déploiements et les mises à jour.
---

La CLI `tale` est l'outil de l'opérateur pour piloter une instance auto-hébergée depuis une station de travail. Elle enveloppe les opérations les plus fréquentes — déployer une nouvelle version, lancer des migrations, capturer des diagnostics — pour t'éviter de te souvenir de chaque invocation `docker compose`. Ce parcours l'installe sur les trois plateformes prises en charge et la pointe vers ton instance.

La CLI est optionnelle. Tout ce qu'elle fait peut être fait avec `docker compose` et `ssh` directement ; la CLI est une commodité pour les équipes qui préfèrent une surface de commandes unique. Si l'équipe est déjà profondément dans sa propre automatisation, saute cette page et reste sur compose.

## Avant de commencer

Il te faut :

- Une station de travail sous macOS, Linux ou Windows 10+.
- Un accès SSH à l'hôte où tourne ton instance Tale, avec l'utilisateur opérateur capable de lancer `docker compose`.
- La clé admin de [Premier admin](/fr/self-hosted/install/first-admin) à portée de main.

L'installeur télécharge un binaire de release depuis GitHub. Les réseaux d'entreprise qui bloquent les téléchargements de contenu brut doivent autoriser `raw.githubusercontent.com` et `github.com`.

## Étape 1 — Lancer install-cli.sh ou install-cli.ps1

Sur macOS ou Linux :

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

Sur Windows PowerShell :

```powershell
iwr https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

Les deux installeurs détectent l'OS, récupèrent le binaire de release correspondant depuis la dernière release GitHub, et le déposent sur le `PATH` (`/usr/local/bin/tale` ou `%LOCALAPPDATA%\Programs\tale\tale.exe`). Pour fixer une version, règle la variable d'environnement `VERSION` avant de piper dans l'installeur.

| OS      | Script d'installeur       |
| ------- | ------------------------- |
| macOS   | `scripts/install-cli.sh`  |
| Linux   | `scripts/install-cli.sh`  |
| Windows | `scripts/install-cli.ps1` |

## Étape 2 — Vérifier

```bash
tale --version
```

La CLI imprime sa version. Si la commande n'est pas trouvée, l'installeur a déposé le binaire hors du `PATH` — la sortie de l'installeur nomme le répertoire de destination.

## Étape 3 — Configurer la clé admin

```bash
tale config set host tale.example.com
tale config set admin-key <clé-de-premier-admin>
```

La CLI enregistre la configuration sous `~/.config/tale/config.yml`. La clé admin authentifie les appels de la CLI vers le conteneur platform ; faire tourner la plateforme redémarre la clé, donc rafraîchis-la à ce moment-là.

## Étape 4 — Lancer tale deploy

```bash
tale deploy
```

`tale deploy` récupère les dernières images pour la `TALE_VERSION` configurée, redémarre les conteneurs affectés dans le bon ordre, et lance les migrations de schéma. C'est le remplacement pris en charge pour la danse plus longue `docker compose pull && docker compose up -d`. Si tu préfères compose directement, le même effet vit dans [Mises à jour](/fr/self-hosted/operate/upgrades).

## Dépannage

- **`tale --version` s'imprime mais `tale deploy` échoue avec « host not configured ».** Lance d'abord `tale config set host …` ; la CLI ne prend pas l'hôte depuis `.env`.
- **`tale deploy` échoue avec « auth failed ».** La clé admin a tourné depuis que tu l'as configurée. Relance `./scripts/get-admin-key.sh` sur l'hôte et `tale config set admin-key …` sur la station.
- **L'installeur échoue sur macOS avec un avertissement Gatekeeper.** Le binaire est signé mais pas encore notarié sur Apple Silicon ; l'installeur imprime la commande `xattr` pour effacer le drapeau de quarantaine.
- **`tale` introuvable après installation sous Linux.** L'installeur dépose le binaire dans `/usr/local/bin` ; vérifie que le répertoire est dans le `PATH` de l'utilisateur (`echo $PATH`).

## Où ça s'utilise

Une fois la CLI branchée, la surface quotidienne de l'opérateur se réduit à une poignée de sous-commandes. Les pages à lire ensuite dépendent de pourquoi tu es venu — [Mises à jour](/fr/self-hosted/operate/upgrades) pour les bumps de version, [Sauvegardes et restauration](/fr/self-hosted/operate/backups-and-restore) pour les exercices de snapshot, [Architecture des conteneurs](/fr/self-hosted/operate/container-architecture) pour ce que la CLI redémarre quand elle déploie.
