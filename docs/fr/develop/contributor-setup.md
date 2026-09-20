---
title: Démarrer Tale depuis les sources
description: Prépare ton environnement local, démarre le backend et l’application, puis vérifie ta contribution.
---
Démarre Tale depuis les sources pour modifier le produit ou tester une contribution. L’application web et le backend tournent sur ta machine, avec les bases de données et les services sandbox dans Docker. Pour installer une version prête à l’emploi, suis le [démarrage auto-hébergé](/fr/self-hosted/install/quickstart).

## Préparer ta machine

Utilise un clone local du [dépôt Tale](https://github.com/tale-project/tale). Exécute les commandes suivantes à sa racine.

| Prérequis | Rôle | Vérification |
| --- | --- | --- |
| Version de Bun fixée dans le `package.json` à la racine | Workspaces, dépendances, Vite et scripts de développement | `bun --version` |
| Node.js 22.21.1 ou plus récent dans la branche 22.x | Backend de l’application ; l’image utilise 22.21.1 | `node --version` |
| Docker avec Compose | Bases applicative et documentaire, stockage objet et services sandbox | `docker info` et `docker compose version` |
| Ports locaux libres | Application sur 3000, backend sur 3005 | `bun run setup:check` |

Le dépôt fixe la version du gestionnaire de paquets. Utilise-la pour reproduire un problème ou modifier le lockfile ; la vérification de démarrage ne contrôle qu’une version minimale.

La vérification préalable contrôle Bun et les deux ports. Vérifie Node et Docker séparément : un résultat positif ne les valide pas. Le premier démarrage nécessite aussi un accès réseau pour télécharger les dépendances et les images. Un fournisseur de modèles est nécessaire pour obtenir de vraies réponses AI, mais pas pour te connecter et explorer l’application.

## Installer et démarrer

Installe les dépendances, vérifie les ports, puis démarre l’environnement :

```bash
bun install
bun run setup:check
bun run dev
```

Le script à la racine crée les secrets manquants dans le fichier `.env`, ignoré par Git, et conserve les valeurs existantes. Garde ce fichier privé et conserve-le entre les redémarrages : le backend et la sandbox doivent partager les mêmes secrets.

L’orchestrateur démarre les services Docker, lance le backend Node, attend ses routes API et d’authentification, puis démarre Vite. Si l’image d’exécution de la sandbox manque, par exemple au premier démarrage ou après la suppression des images locales, l’orchestrateur la construit depuis les sources avant de lancer le backend. Cette seule étape peut prendre plusieurs minutes ; les sessions d’agents et l’exécution de code restent indisponibles tant qu’elle n’est pas terminée. Le backend applique les migrations au démarrage. Attends le message `READY` avant d’ouvrir `http://localhost:3000` ; les téléchargements et la préparation initiale peuvent prolonger le premier démarrage.

<Check>

Ouvre l’application et connecte-toi. Le Dashboard confirme la liaison entre navigateur et backend. Envoie un message avec un fournisseur configuré pour vérifier aussi un appel au modèle.

</Check>

Arrête les processus au premier plan avec `Ctrl-C`. Les volumes Docker persistent ; l’arrêt ne supprime pas les données de l’instance.

## Se connecter au workspace local

L’initialisation de développement crée le compte `dev@tale.test`, le mot de passe `TaleDev!Passw0rd` et l’organisation **Dev Workspace**. Elle ne modifie pas un compte existant et ne fonctionne que si `SITE_URL` désigne une adresse de boucle locale.

Définis `TALE_DEV_SEED_USER=0` pour tester la première configuration. Pour une autre identité locale, fournis `TALE_DEV_SEED_USER_EMAIL` et `TALE_DEV_SEED_USER_PASSWORD` dans l’environnement. Modifier ces valeurs ne réinitialise pas le mot de passe d’un compte existant.

## Choisir les services à lancer

Pour travailler sur le produit, conserve `bun run dev`. Il démarre ensemble le backend et l’application avec leur configuration commune.

Si les services nécessaires tournent déjà avec les bons ports et identifiants, ignore uniquement leur démarrage Docker :

```bash
TALE_DEV_SKIP_DOCKER=1 bun run dev
```

Cette commande démarre toujours un backend local. Postgres, le stockage objet et la sandbox restent nécessaires. Consulte les [fichiers Compose de développement](/fr/develop/compose-files) pour tester une compilation complète en conteneurs.

Pour travailler uniquement sur le frontend avec un backend existant, lance Vite directement depuis `services/platform` et indique son adresse :

```bash
cd services/platform
TALE_BACKEND_URL=http://localhost:3005 bunx --bun vite --host 127.0.0.1 --port 3000
```

Cette commande ne démarre aucun service, ne crée aucun compte et n’applique aucune migration. Le backend doit déjà accepter l’origine du navigateur que tu utilises.

## Résoudre les problèmes de démarrage

| Symptôme | Vérification suivante |
| --- | --- |
| `node` est absent ou refuse une option | Installe la version Node indiquée et vérifie celle que trouve ton shell. |
| Docker ne se connecte pas | Démarre Docker et exécute `docker info` dans le même shell. |
| Le port 3000 ou 3005 est occupé | Identifie le processus avant de l’arrêter ; il peut appartenir à un autre clone. |
| Le backend échoue avant Vite | Lis la première erreur et vérifie la connexion à la base et ses identifiants. |
| La connexion fonctionne, mais pas le modèle | Vérifie l’identifiant du fournisseur, le modèle choisi et les services sandbox. |
| Tes changements apparaissent dans la mauvaise application | Vérifie l’URL et le clone auquel appartient le processus. |

Sur macOS ou Linux, identifie les processus à l’écoute :

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:3005 -sTCP:LISTEN
```

Arrête un processus de développement connu depuis son terminal d’origine. N’arrête pas un processus uniquement parce qu’il occupe un port.

## Conserver ou réinitialiser les données locales

Les bases et fichiers téléversés persistent hors du clone. Un second worktree Git n’isole pas automatiquement les noms de services Docker, les ports, les volumes ou les identifiants `.env`. Donne à chaque instance ses propres services et sa propre configuration avant de les lancer en parallèle.

Une réinitialisation détruit les données de développement et peut toucher un autre clone qui utilise le même projet Compose. Inspecte les conteneurs et volumes du projet, sauvegarde ce qui compte et arrête les services avant de supprimer leur état. Les fichiers sous `TALE_CONFIG_DIR` sont indépendants : supprimer une base ne les réinitialise pas.

## Réutiliser les composants d’interface

Pour modifier une interface, commence par les [guides du design system](https://ui.tale.dev). Ils présentent `@tale/ui` pour l’application et `@tale/marketing-ui` pour les pages marketing, avec des exemples interactifs, des tokens et des modèles de mise en page. Cherche un composant existant dans ces packages avant d’en créer un. Ces guides sont en anglais.

## Vérifier une contribution

Lis `AGENTS.md` et `.agents/repo.md` avant de modifier le code. Exécute les vérifications adaptées pendant ton travail, puis la vérification commune depuis la racine :

```bash
bun run check
```

Elle couvre le formatage, le lint, les types et les tests automatisés. Le formatage Python utilise aussi `uvx` ; installe cet outil avant le passage complet. Vérifie également les comportements web dans un navigateur. Pour une modification de base de données, le contrat du dépôt exige le test d’intégration sur un vrai Postgres.

Mets à jour la documentation concernée et toutes les langues livrées avec ta modification. Pour les conteneurs, poursuis avec [Construire les images Docker](/fr/develop/contributing-docker) ; pour une intégration externe, commence par [Appeler Tale depuis un script](/fr/tutorials/developer/call-tale-from-a-script).
