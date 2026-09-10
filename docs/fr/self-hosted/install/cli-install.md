---
title: Installer la CLI tale
description: Installer la CLI tale sur macOS, Linux ou Windows — et la configurer contre ton instance auto-hébergée pour les déploiements et les mises à jour.
---

La CLI `tale` est la façon recommandée de faire tourner et d'exploiter Tale. Le [démarrage rapide](/fr/self-hosted/install/quickstart) l'utilise déjà pour monter une instance en local avec `tale init` et `tale dev` ; cette page est l'autre moitié — installer la CLI sur une station de travail pour qu'elle puisse piloter une instance _distante_ : déployer de nouvelles versions, lancer des migrations et capturer des diagnostics sans que tu aies à te souvenir de chaque invocation `docker compose`.

La même CLI gère les opérations du workspace sur les conteneurs, les déploiements depuis des commits source exacts et les releases de configuration client. Ton automatisation choisit la destination, les références et les références d’identifiants, puis appelle la CLI. [Publier les configurations d’un client](/fr/self-hosted/configuration/config-releases) traite les contenus conservés dans son propre repository.

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

Pour les opérations du workspace sur les conteneurs, utilise le projet créé par `tale init`. La CLI cherche son fichier `tale.json` en remontant les répertoires ; vérifie le projet résolu avec :

```bash
tale config show
```

Les releases de configuration et les [déploiements gérés](#deploiements-geres) désignent explicitement sources et destinations, sans s’aligner sur un workspace voisin. `config show` garde son comportement existant pour les projets locaux.

Pour un déploiement de workspace, l’hôte du proxy, les réglages TLS et les secrets vivent dans son `.env`. Modifie `HOST` ou passe `--host` à `tale dev` / `tale deploy`. Pour un workspace distant, utilise le contexte Docker de ton shell ou `DOCKER_HOST`. Un bundle géré s’applique sur la destination déclarée avec son daemon Docker local.

## Étape 4 — Lancer tale deploy

```bash
tale deploy
```

Sans `--bundle`, `tale deploy` déploie la version de la CLI : il récupère ses images, redémarre les conteneurs concernés dans l’ordre prévu et exécute les migrations. Choisis auparavant une autre version de workspace avec `tale update`. Pour des commits source distincts du runtime et du client, suis [Déploiements gérés](#deploiements-geres).

## Référence des commandes

Le CLI regroupe ses commandes selon ce que tu fais, comme le fait `tale --help`. Chaque commande et ses arguments sont listés ci-dessous. Comment lire la notation :

- Un argument positionnel entre `[crochets]` est **optionnel** ; entre `<chevrons>`, il est **requis**.
- Les options obligatoires des releases de configuration sont indiquées explicitement ; les autres options sont facultatives, sauf indication contraire dans l’aide de la commande.
- Une option de la forme `--option <valeur>` **exige une valeur** quand tu l'utilises (p. ex. `--port 8443`) ; une option seule comme `--detach` est un commutateur booléen.
- Les **valeurs par défaut** figurent entre parenthèses après la description. Aucune valeur par défaut signifie que l'option est désactivée, ou que la valeur est résolue depuis `.env` / le contexte.

Lance `tale <commande> --help` pour la liste de référence de ta version installée.

**Les options globales** fonctionnent sur chaque commande :

- `--verbose` — sortie détaillée : logs de débogage et flux brut du sous-processus (forme longue uniquement ; il n'y a pas de `-v`).
- `-q, --quiet` — uniquement les avertissements et les erreurs.
- `-y, --yes` — répondre « oui » à toutes les questions (non interactif).
- `--no-color` — désactiver les couleurs ANSI (respecte aussi `NO_COLOR` / `FORCE_COLOR`).
- `--json` — JSON lisible par machine sur stdout ; pris en charge par `status`, toutes les sous-commandes `config` et les commandes de déploiement géré.
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

### Déploiements gérés

Utilise une déclaration de déploiement vérifiée quand le runtime et les configurations client doivent suivre des commits source exacts. Ton automatisation choisit la destination, les identifiants et les références, puis appelle la CLI Tale. Celle-ci acquiert les sources, résout et vérifie les digests des images, prépare le transfert, préserve l’état existant pris en charge, crée les snapshots de récupération nécessaires, déploie le stack, provisionne l’instance native et vérifie la configuration. Cette logique de déploiement reste dans Tale.

Lance la préparation sous Linux avec une CLI compilée depuis un checkout Tale propre et committé, pour l’architecture cible `linux/amd64` ou `linux/arm64`. Le même exécutable accompagne le paquet pour le provisionnement local au backend. La préparation demande Git et Docker pour vérifier sources et images. L’application s’exécute sur la destination avec son daemon Docker local, son répertoire d’état conservé et son environnement. Le commit complet de CLI, le commit source du runtime et celui de la configuration client sont trois références distinctes.

Les commandes de bundle géré ne sont pas disponibles sous Windows, y compris `deploy verify-bundle` et le `deploy provision` local au backend : leurs contrôles d’intégrité exigent les droits d’exécution POSIX. Exécute le déploiement géré complet sur un hôte Linux. Les commandes ordinaires du workspace et les commandes autonomes `config build`, `verify`, `stage`, `deploy` et `verify-native` restent disponibles sous Windows.

Cet exemple synthétique cible une organisation et un projet existants. Remplace les ID publics et définis les variables nommées. `revision` accepte un SHA de commit complet ou une référence d’environnement. Les identifiants restent des références, résolues en privé sur la destination. `tlsMode: "external"` suppose qu’un point d’entrée existant gère le TLS public ; `letsencrypt` demande aussi `tlsEmail`.

Pour les jobs Linux de GitHub Actions, utilise l’action composite Tale `.github/actions/setup-cli`. Fixe la référence de l’action et son entrée `revision` au même commit Tale complet. Elle compile avec Bun 1.4.2, fournit la sortie `executable` et ajoute le binaire au `PATH`.

`origin` et chaque entrée native `redirectUris` acceptent aussi des références d’environnement. Un registre de déploiement peut ainsi posséder les adresses publiques. La préparation les résout en URL HTTPS littérales validées dans le bundle.

```json
{
  "schemaVersion": 1,
  "name": "example-native",
  "stateDirectory": "/opt/tale-example",
  "composeProject": "tale-example",
  "runtime": {
    "revision": { "env": "TALE_RUNTIME_REF" },
    "platform": "linux/amd64"
  },
  "origin": { "env": "TALE_PUBLIC_ORIGIN" },
  "tlsMode": "external",
  "identity": {
    "email": { "env": "EXAMPLE_OPERATOR_EMAIL" },
    "password": { "env": "EXAMPLE_OPERATOR_PASSWORD" },
    "slug": "example-team",
    "name": "Example team",
    "ssoEnabled": false,
    "nativeClients": [
      {
        "key": "example-portal",
        "name": "Example portal",
        "clientId": { "env": "EXAMPLE_NATIVE_CLIENT_ID" },
        "redirectUris": [{ "env": "EXAMPLE_PORTAL_CALLBACK" }]
      }
    ]
  },
  "configs": [
    {
      "repository": "https://github.com/example-team/client-app",
      "revision": { "env": "EXAMPLE_CONFIG_REF" },
      "client": "example-team",
      "descriptor": "tale/client.json",
      "automation": "document-review",
      "projectId": "existing-project-id",
      "skillOwner": "native-operator-id"
    }
  ]
}
```

Définis `TALE_DEPLOY_SPEC` avec ce fichier JSON, `TALE_DEPLOY_BUNDLE` avec un nouveau répertoire absolu et `TALE_CLI_COMMIT` avec le commit complet du binaire. `DEPLOYMENT_COMMIT` est une provenance d’orchestration optionnelle ; omets ses arguments si tu ne l’utilises pas. Prépare et vérifie, transfère le répertoire entier, puis lance l’aperçu et le déploiement sur la destination avec la même CLI fixée.

```bash
tale --json deploy prepare \
  --spec "$TALE_DEPLOY_SPEC" \
  --deployment-ref "$DEPLOYMENT_COMMIT" \
  --output "$TALE_DEPLOY_BUNDLE"

tale --json deploy verify-bundle \
  --bundle "$TALE_DEPLOY_BUNDLE" \
  --cli-ref "$TALE_CLI_COMMIT" \
  --deployment-ref "$DEPLOYMENT_COMMIT"

tale --json deploy --bundle "$TALE_DEPLOY_BUNDLE" \
  --cli-ref "$TALE_CLI_COMMIT" \
  --deployment-ref "$DEPLOYMENT_COMMIT" --dry-run

tale --json --yes deploy --bundle "$TALE_DEPLOY_BUNDLE" \
  --cli-ref "$TALE_CLI_COMMIT" \
  --deployment-ref "$DEPLOYMENT_COMMIT"
```

`deploy prepare` accepte `--sources-file <file>` pour associer `repository@fullSHA` à des checkouts exacts existants. Sinon, la CLI récupère des repositories GitHub canoniques. Injecte le contenu d’une clé SSH en lecture seule pour les repositories client privés dans `TALE_SOURCE_SSH_KEY`, uniquement pendant la préparation. La CLI vérifie les clés d’hôte SSH de GitHub par HTTPS et garde la clé hors du paquet et du runtime. Docker doit déjà avoir accès au registre.

`deploy verify-bundle` vérifie l’inventaire complet et les hashes sans contacter la destination. `deploy --bundle --dry-run` vérifie les artefacts de configuration et les préconditions de la destination sans appliquer de changement. Les déploiements gérés refusent les options réservées au workspace comme `--services`, `--host` ou `--override-all`. Ils déploient le stack en préservant son état, avec des contrôles de santé et de provenance. Le comportement blue-green du workspace décrit plus haut est un autre parcours.

`deploy provision [--bundle <directory>]` est la phase locale au backend, normalement appelée par le déploiement du bundle. Elle lit au maximum 64 KiB de JSON privé sur stdin, vérifie le compte local existant et l’organisation sélectionnée, puis ferme toujours la session avant d’annoncer le succès. Ses champs sont `origin`, `email`, `password`, `slug`, `name`, `ssoEnabled`, les champs Entra optionnels `tenantId`/`clientId`/`clientSecret` et les éventuels `nativeClients` avec `key`, `name`, `clientId` existant et `redirectUris` HTTPS. Le mode local ne crée jamais de compte ou d’organisation de remplacement. Le mode Entra actif exige ses trois champs d’identifiants et conserve la procédure de première installation. Un bundle lie aussi l’identité publique et les configurations préparées avant toute modification native. `deploy provision` refuse les options de workspace et `--dry-run` ; utilise les vérifications en lecture seule du bundle et de la configuration. Les attentes optionnelles `--cli-ref` et `--deployment-ref` exigent `--bundle` et sont vérifiées avant la connexion.

Les clients natifs gérés doivent déjà exister. Leurs ID, politiques de sécurité et secrets restent inchangés ; seuls le nom affiché et les URL de callback peuvent converger. Sur les backends 0.5 pris en charge, une modification nécessaire utilise l’adaptateur d’authentification natif du serveur depuis deux modules fixes du conteneur, puis ferme les deux connexions. Une correspondance exacte ne charge aucun module backend. Ce chemin n’active ni la route publique OAuth de mise à jour désactivée, ni des chemins de modules arbitraires, imports backend distants, inscriptions ou rotations de secret.

Conserve le répertoire d’état, les snapshots et les reçus natifs. Le reçu final n’est écrit qu’après vérification du runtime sain, relecture de la configuration native et fermeture de session. Si une phase tardive échoue, les changements déjà terminés peuvent rester en place ; examine les preuves conservées avant de relancer. Les verrous locaux coordonnent un hôte, sans compare-and-swap entre hôtes ni protection contre les modifications d’un admin natif.

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

`tale update` — changer la version d’une instance de workspace : mettre à jour la CLI et synchroniser les fichiers projet, puis lancer `tale deploy`. Les commandes du workspace s’alignent sur cette version. Les bundles gérés et releases de configuration gardent leur révision de CLI fixée séparément.

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

`tale config show` — afficher le répertoire du projet local résolu et la version de CLI. Hors d’un projet, la commande signale qu’aucun projet n’a été trouvé et se termine sans erreur.

### Releases de configuration

Ces commandes utilisent la révision de CLI choisie sans alignement sur une instance ni opération Docker. [Publier les configurations d’un client](/fr/self-hosted/configuration/config-releases) couvre les descripteurs, commits source, identifiants et reprises. L’identité par défaut est le SHA source complet : manifeste schéma 4/compilateur 3 avec `releaseRef === sourceCommit`. Les numéros entiers de version native restent distincts.

`build`, `verify` et `stage` exigent `--repo <directory>`, `--descriptor <path>` et `--automation <name>`. Le chemin du descripteur est relatif au repository. Celui du manifeste à vérifier peut être absolu ou relatif au repository.

| Commande             | Options obligatoires                         | Options facultatives                                                                                                                     |
| -------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `tale config build`  | `--source-commit <sha>`                      | `--skill-owner <user-id>` (requis pour les skills propres au paquet), `--output <directory>`, compatibilité `--config-version <version>` |
| `tale config verify` | `--manifest <path>`                          | `--rebuild` pour la reconstruction exacte hors ligne                                                                                     |
| `tale config stage`  | `--config-ref <sha>`, `--output <directory>` | `--skill-owner <user-id>`, `--client <name>`, `--deployment-ref <sha>`                                                                   |

La préparation source exige un checkout dont `HEAD` est ce commit complet et une sortie hors du checkout. Elle reconstruit les contenus committés sans commit de catalogue généré. `stage --config-version` choisit explicitement l’ancien parcours compatible et exige `--catalogue-commit`, `--catalogue-repository`, `--client` et `--ops-commit`. Ne combine pas `--config-ref` et `--config-version`.

Les commandes natives exigent `--stage <directory>`, `--url <origin>`, `--org <id>` et `--project <id>`. HTTPS est obligatoire sauf pour HTTP local ; utilise `--origin <origin>` pour l’origine canonique du navigateur derrière un proxy. Les deux lisent `TALE_CONFIG_COOKIE` uniquement dans l’environnement.

| Commande                    | Options obligatoires            | Options facultatives                                              |
| --------------------------- | ------------------------------- | ----------------------------------------------------------------- |
| `tale config deploy`        | `--receipt <path>`              | `--yes` global pour un déploiement sans interaction déjà autorisé |
| `tale config verify-native` | Aucune autre option obligatoire | `--native-version <number>`, `--allow-retained`                   |

Les deux commandes natives acceptent les attentes exactes `--config-ref`, `--source-repository`, `--artifact-sha256`, `--deployment-ref`, `--client` et `--automation`. Les anciens arguments de catalogue restent compatibles. `verify-native` est en lecture seule ; `--allow-retained` vérifie une version conservée choisie explicitement sans la présenter comme déployée. Sans `--native-version`, la vérification choisit la dernière version enregistrée. L’API native expose le contrat de tâche uniquement pour la version déployée ; une vérification conservée ne peut donc pas attester ce champ.

Les commandes de configuration n’ont pas de `--dry-run` : utilise `stage`, `verify --rebuild` et `verify-native`. Le JSON de succès est `{ok:true,command:"config <verb>",data}`. Les données de build et de vérification incluent `automationName`, `releaseRef`, `sourceCommit`, `artifactSha256`, `artifactPath` et `verified` ; la sortie compatible emploie `configVersion` à la place de `releaseRef`. Les reçus de transfert SHA et les reçus natifs utilisent le schéma 2. Un résultat de déploiement contient `automationVersion` et `unchanged` ; le champ explicite `verified` appartient aux sorties de vérification.

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
