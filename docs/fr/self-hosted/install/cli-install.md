---
title: Installer la CLI tale
description: Installer la CLI tale sur macOS, Linux ou Windows — et la configurer contre ton instance auto-hébergée pour les déploiements et les mises à jour.
---

La CLI `tale` est la façon recommandée de faire tourner et d'exploiter Tale. Le [démarrage rapide](/fr/self-hosted/install/quickstart) l'utilise déjà pour monter une instance en local avec `tale init` et `tale dev` ; cette page est l'autre moitié — installer la CLI sur une station de travail pour qu'elle puisse piloter une instance _distante_ : déployer de nouvelles versions, lancer des migrations et capturer des diagnostics sans que tu aies à te souvenir de chaque invocation `docker compose`.

Tout ce que fait la CLI peut aussi se faire directement avec `docker compose` et `ssh`, donc une équipe déjà profondément dans sa propre automatisation peut rester sur compose. Pour tous les autres, la CLI est le chemin le plus court, et le reste de la doc auto-hébergée suppose qu'elle est installée.

## Avant de commencer

Il te faut :

- Une station de travail sous macOS, Linux ou Windows 10+.
- Un accès SSH à l'hôte où tourne ton instance Tale, avec l'utilisateur opérateur capable de lancer `docker compose`.

L'installeur télécharge un binaire de release depuis GitHub. Les réseaux d'entreprise qui bloquent les téléchargements de contenu brut doivent autoriser `raw.githubusercontent.com` et `github.com`.

## Étape 1 — Lancer install-cli.sh ou install-cli.ps1

Sur macOS ou Linux :

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

Sur Windows PowerShell :

```powershell
irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

Les deux installeurs détectent l'OS et l'architecture CPU, récupèrent le binaire de release correspondant depuis la dernière release GitHub, et le déposent sur le `PATH` (`/usr/local/bin/tale` ou `%LOCALAPPDATA%\Programs\tale\tale.exe`) — quand le répertoire d'installation n'est pas accessible en écriture, l'installeur demande `sudo`. Les binaires de release existent pour macOS sur Apple Silicon et Intel, et pour Linux sur x86_64 et arm64 ; les machines Windows-on-ARM exécutent le binaire x64 via l'émulation intégrée. Sur une architecture sans binaire de release, l'installeur s'arrête avec un message clair et renvoie vers la compilation depuis les sources. Pour fixer une version, règle la variable d'environnement `VERSION` avant de piper dans l'installeur ; pour choisir toi-même le répertoire d'installation, règle `INSTALL_DIR`.

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

## Étape 3 — Vérifier la configuration

Il n'y a pas de `tale config set` — tout ce dont la CLI a besoin vit dans le projet créé par `tale init`. Lance chaque commande `tale` depuis ce répertoire (la CLI remonte l'arborescence pour trouver `tale.json`), et vérifie qu'il se résout :

```bash
tale config show
```

L'hôte sur lequel le proxy répond, les réglages TLS et tous les secrets vivent dans le `.env` du projet. Pour changer l'hôte, modifie `HOST` là-bas ou passe `--host` à `tale dev` / `tale deploy`. Pour piloter un hôte distant, pointe le contexte Docker de ton shell (ou `DOCKER_HOST`) dessus — la CLI parle au même endpoint Docker que n'importe quelle commande `docker`.

## Étape 4 — Lancer tale deploy

```bash
tale deploy
```

`tale deploy` livre toujours la version de la CLI elle-même : il récupère les images de cette version, redémarre les conteneurs affectés dans le bon ordre, et lance les migrations de schéma — pour passer à une autre version, commence par `tale update`. C'est le remplacement pris en charge pour la danse plus longue `docker compose pull && docker compose up -d`. Si tu préfères compose directement, le même effet vit dans [Mises à jour](/fr/self-hosted/operate/upgrades).

## Référence des commandes

Le CLI regroupe ses commandes selon ce que tu fais, comme le fait `tale --help`. Chaque commande et ses arguments sont listés ci-dessous. Comment lire la notation :

- Un argument positionnel entre `[crochets]` est **optionnel** ; entre `<chevrons>`, il est **requis**.
- Chaque option est **optionnelle** — l'omettre donne le comportement par défaut.
- Une option de la forme `--option <valeur>` **exige une valeur** quand tu l'utilises (p. ex. `--port 8443`) ; une option seule comme `--detach` est un commutateur booléen.
- Les **valeurs par défaut** figurent entre parenthèses après la description. Aucune valeur par défaut signifie que l'option est désactivée, ou que la valeur est résolue depuis `.env` / le contexte.

Lance `tale <commande> --help` pour la liste de référence de ta version installée.

**Les options globales** fonctionnent sur chaque commande :

- `--verbose` — sortie détaillée : logs de débogage et flux brut du sous-processus (forme longue uniquement ; il n'y a pas de `-v`).
- `-q, --quiet` — uniquement les avertissements et les erreurs.
- `-y, --yes` — répondre « oui » à toutes les questions (non interactif).
- `--no-color` — désactiver les couleurs ANSI (respecte aussi `NO_COLOR` / `FORCE_COLOR`).
- `--json` — JSON lisible par machine sur stdout, messages humains sur stderr ; pris en charge par `status` et `config show`.
- `--ci` — forcer une sortie non interactive en mode ajout seul (sans contrôle du curseur).

Les commandes se terminent avec `0` en cas de succès, `2` pour une erreur d'utilisation, `3` pour une condition préalable non remplie (pas de projet, Docker arrêté, port occupé), `4` pour une interruption par l'utilisateur (Ctrl-C, ou une question requise sans terminal) et `5` pour l'échec d'une dépendance externe — ainsi les scripts peuvent se ramifier selon la cause.

### Installation

`tale init [directory]` — créer un projet : échafaude les configs d'exemple, `AGENTS.md` + un pointeur `CLAUDE.md` et un `.env` local par défaut (localhost, certificat auto-signé, secrets générés). Aucun Docker requis ; le domaine de production et le TLS sont choisis plus tard, lors de `tale deploy`. Dans un terminal, il demande un nom de projet quand `directory` est omis, confirme avant d'écraser un projet existant, et demande une fois si les agents peuvent lancer `docker` dans les sandboxes (par défaut : non — l'activer fait tourner un Docker interne privilégié) ; les exécutions non interactives sautent toutes les questions. `directory` est optionnel (par défaut : le répertoire courant).

- `-f, --force` — écraser un `tale.json` existant au lieu d'abandonner.
- `--no-env` — échafauder le projet mais ignorer la génération du `.env`.

`tale dev` — démarrer tous les services localement avec un certificat auto-signé.

- `-d, --detach` — s'exécuter en arrière-plan au lieu de diffuser les logs.
- `-p, --port <port>` — port HTTPS à exposer (par défaut `443`).
- `--host <hostname>` — alias d'hôte pour le proxy (par défaut `localhost`).
- `-y, --yes` — non-interactif : accepter automatiquement les invites (p. ex. installer ou démarrer Docker).

`tale deploy` — déploiement blue-green sans interruption de la version actuelle du CLI. Au premier déploiement, il demande ton domaine de production et l'e-mail Let's Encrypt (ou passe `--host`).

- `--stop` — mettre aussi à jour le palier arrêté-puis-recréé (`db`, `proxy`) — ces conteneurs sont recréés, donc accepte une brève interruption ; sans l'option, les `db`/`proxy` en marche restent intouchés.
- `-s, --services <list>` — ne mettre à jour que ces services séparés par des virgules (par défaut : tous les services rotatifs).
- `--host <hostname>` — alias d'hôte pour le proxy (par défaut : la valeur `HOST` de `.env`).
- `--override` — écraser la config du conteneur depuis le workspace local (les `*.secrets.json` chiffrés et `.history/` sont toujours préservés).
- `--override-all` — réinitialiser le catalogue intégré dans chaque organisation côté serveur ; implique `--stop`.
- `-q, --quiet` — masquer les logs des conteneurs pendant le déploiement.
- `-y, --yes` — accepter automatiquement les confirmations destructives (p. ex. `--override-all`).
- `--skip-backup` — ignorer le snapshot de volume automatique d'avant déploiement.
- `--dry-run` — prévisualiser sans rien modifier.

### Exploitation

`tale status` — afficher l'état actuel du déploiement. Aucun argument.

`tale logs <service>` — diffuser les logs d'un service (`service` est l'un des services en cours d'exécution ; sur une stack de dev sans déploiement, la commande retombe sur le conteneur de dev).

- `-f, --follow` — suivre la sortie des logs au fil de l'écriture.
- `-n, --tail <lines>` — n'afficher que les N dernières lignes.
- `--since <duration>` — afficher les logs depuis une durée relative (p. ex. `1h`, `30m`).
- `-c, --color <color>` — cibler une couleur de déploiement précise (`blue` ou `green`).
- `--raw` — diffuser la sortie brute, non filtrée (aucune classification).

`tale backup` — snapshot de tous les volumes de données vers le volume de sauvegardes du projet. Aucun argument.

`tale restore [snapshot-id]` — restaurer un snapshot ; sans id, la liste des snapshots disponibles s'affiche.

- `--stop` — arrêter les conteneurs du projet avant la restauration.
- `-y, --yes` — ignorer l'invite de confirmation.

`tale rollback` — revenir à la version patch précédente (niveau patch uniquement). Demande confirmation au préalable.

- `-y, --yes` — ignorer l'invite de confirmation (requis en mode non-interactif).

### Maintenance

`tale update` — bouger cette instance Tale vers une nouvelle version : mettre à jour le binaire CLI, puis synchroniser les fichiers projet sur les templates de cette version. Lance `tale deploy` ensuite pour rouler les conteneurs. La CLI s'aligne aussi d'elle-même sur la version de l'instance à chaque commande, donc ceci n'est nécessaire que pour changer délibérément de version.

- `-v, --version <version>` — mettre à jour vers exactement cette version (p. ex. `0.9.0`) au lieu de la dernière ; autorise les rétrogradations.
- `-f, --force` — forcer la re-synchronisation et écraser les fichiers projet modifiés localement.
- `--dry-run` — montrer ce qui changerait sans rien modifier.

`tale migrate` — reprovisionner les valeurs par défaut intégrées pour chaque organisation sur le déploiement en cours — la même étape idempotente que chaque déploiement exécute, à la demande. Les migrations de schéma ne sont pas une commande : le backend les applique au démarrage, donc un conteneur déployé est toujours sur son propre schéma.

- `--dry-run` — montrer ce qui serait exécuté sans l'exécuter.

`tale cleanup` — supprimer les conteneurs inactifs (couleur non courante). Aucun argument.

`tale reset` — supprimer tous les conteneurs blue-green.

- `-f, --force` — ignorer l'invite de confirmation.
- `-a, --all` — supprimer aussi les conteneurs d'infrastructure avec état.
- `--dry-run` — prévisualiser la réinitialisation sans rien modifier.

`tale uninstall` — supprimer le binaire CLI `tale` de ce système. Il demande confirmation avant de supprimer quoi que ce soit et _propose_ de retirer aussi la configuration propre à l'utilisateur (`~/.tale-daemon`) et de démanteler les ressources Docker et les fichiers d'un projet. Sans `--purge`, un projet et ses conteneurs restent intacts — lance `tale reset --all` à l'intérieur pour les supprimer.

- `-f, --force` — ignorer l'invite de confirmation (supprime uniquement le binaire ; les nettoyages optionnels nécessitent toujours `--purge`).
- `--purge` — retirer aussi `~/.tale-daemon` et, pour un projet trouvé depuis le répertoire courant, démanteler ses ressources Docker et supprimer ses fichiers. Irréversible.
- `--dry-run` — montrer ce qui serait supprimé sans rien supprimer.

`tale config` — gérer la configuration du CLI. Utilise le sous-commande `show` pour afficher la configuration résolue.

### Avancé

`tale auth reset-owner` — réinitialiser les identifiants du compte propriétaire.

- `-e, --email <email>` — définir une nouvelle adresse e-mail du propriétaire.
- `-p, --password <password>` — définir un nouveau mot de passe du propriétaire.

## Dépannage

- **`tale deploy` vise la mauvaise machine.** La CLI utilise le contexte Docker / `DOCKER_HOST` de ton shell. Bascule avec `docker context use …` (ou définis `DOCKER_HOST`) pour qu'il pointe sur l'hôte voulu, puis relance.
- **`tale deploy` utilise le mauvais alias d'hôte.** L'hôte sur lequel le proxy répond vient de `HOST` dans le `.env` du projet, pas d'un stockage CLI séparé. Modifie `.env` ou passe `--host` pour le remplacer le temps d'un lancement.
- **L'installeur échoue sur macOS parce que le binaire ne peut pas s'exécuter.** Quand le binaire fraîchement installé refuse de démarrer (p. ex. Gatekeeper le tue), l'installeur échoue avec des pistes de récupération au lieu d'annoncer un succès — suis-les, puis relance l'installeur.
- **`tale` introuvable après installation sous Linux.** L'installeur dépose le binaire dans `/usr/local/bin` ; vérifie que le répertoire est dans le `PATH` de l'utilisateur (`echo $PATH`).

## Où ça s'utilise

Une fois la CLI branchée, la surface quotidienne de l'opérateur se réduit à une poignée de sous-commandes. Les pages à lire ensuite dépendent de pourquoi tu es venu — [Mises à jour](/fr/self-hosted/operate/upgrades) pour les bumps de version, [Sauvegardes et restauration](/fr/self-hosted/operate/backups-and-restore) pour les exercices de snapshot, [Architecture des conteneurs](/fr/self-hosted/operate/container-architecture) pour ce que la CLI redémarre quand elle déploie.
