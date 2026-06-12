---
title: Démarrage rapide auto-hébergé
description: Fais tourner une instance Tale sur ta machine en trois commandes avec la CLI tale — installer, tale init, tale start, puis se connecter.
---

C'est le chemin le plus rapide vers un Tale qui tourne : installe la CLI `tale`, puis deux commandes. Le résultat est ta propre organisation qui tourne sur ta propre machine, joignable dans le navigateur. C'est pensé pour un laptop ou un hôte unique sur lequel tu veux essayer Tale ; quand tu es prêt à le faire tourner pour de vrai, le parcours [Linux serveur](/fr/self-hosted/install/linux-server) couvre une installation de production durcie.

Il te faut deux choses :

- **[Docker Desktop](https://www.docker.com/products/docker-desktop)** (v24+) en marche, ou Docker Engine plus le plugin Compose sous Linux.
- Une **[clé API OpenRouter](https://openrouter.ai)** pour que les agents aient un modèle à qui parler. Tu pourras brancher n'importe quel fournisseur plus tard.

## Étape 1 — Installer la CLI

Sous macOS ou Linux :

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

Sous Windows (PowerShell) :

```powershell
irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

L'installateur détecte ton OS, dépose le binaire `tale` sur ton `PATH`, et c'est la seule étape qui touche ton système. Confirme qu'il a atterri :

```bash
tale --version
```

## Étape 2 — Créer un projet

```bash
tale init my-project
cd my-project
```

`tale init` échafaude un répertoire de projet et te guide à travers l'essentiel : il demande ta clé API OpenRouter, génère chaque secret de sécurité pour toi et écrit le `.env`, de sorte qu'il n'y a rien à éditer à la main. Il dépose aussi des agents, workflows et intégrations d'exemple sous `default/`, et génère la configuration d'éditeur pour Claude Code, Cursor, Copilot et Windsurf afin qu'un éditeur IA puisse construire des configurations en pleine connaissance du schéma.

## Étape 3 — Démarrer Tale

```bash
tale start
```

Le premier passage récupère les images et construit le graphe de conteneurs — compte cinq à dix minutes sur une machine neuve. Dès que la plateforme se signale prête (`Tale Platform is running`), `tale start` ouvre ton navigateur automatiquement. S'il ne peut pas, il imprime l'URL à visiter.

> Ton navigateur affiche un avertissement de certificat pour le certificat auto-signé local. C'est attendu — accepte-le pour continuer.

Ta configuration sous `default/` est montée dans l'instance en marche, donc les édits aux agents, workflows et intégrations rechargent à chaud. Arrête la stack avec `Ctrl-C` (ou `tale start --detach` pour la faire tourner en arrière-plan).

## Étape 4 — Créer ton compte

Sur l'écran de connexion, clique **Sign up** et remplis tes nom, e-mail et mot de passe. Le premier compte sur une instance toute neuve revendique le rôle **Owner** et crée ton **Organisation**. Tu atterris dans le dashboard.

> Si l'écran d'inscription demande une clé admin à usage unique, [Premier admin](/fr/self-hosted/install/first-admin) est la courte marche qui l'imprime et explique comment fermer l'inscription une fois ton équipe entrée.

## Étape 5 — Ajouter un modèle et publier un agent

Tu as maintenant une organisation vide. Deux gestes t'amènent à quelque chose d'utile :

1. Ouvre **Paramètres > Providers** et confirme que ta clé OpenRouter est connectée (la CLI l'a ajoutée pendant `tale init`).
2. Publie ton premier agent — [Créer un agent](/fr/platform/agents/create) le mène d'un rôle et de quelques instructions à un spécialiste fonctionnel.

À partir de là, la doc [Platform](/fr/platform) est la référence canonique pour chaque fonctionnalité, et elle est identique à Cloud.

## Plutôt du Docker Compose brut ?

La CLI enveloppe `docker compose` pour que tu n'aies pas à le faire. Si tu préfères faire tourner la stack depuis un clone du dépôt et gérer Compose toi-même — pour la transparence, des builds air-gapped ou ta propre automation — clone le dépôt, copie `.env.example` vers `.env`, règle `HOST` et `SITE_URL`, génère les secrets et `docker compose up -d`. Le parcours [Linux serveur](/fr/self-hosted/install/linux-server) et la [référence Docker Compose](/fr/self-hosted/install/docker-compose-reference) couvrent ce chemin de bout en bout.

## Dépannage

- **`tale` introuvable après l'installation.** L'installateur nomme le répertoire de destination dans sa sortie ; assure-toi que ce répertoire est sur ton `PATH` (sous Linux, c'est généralement `/usr/local/bin`).
- **`tale start` se termine sur un conflit de port.** Un autre service lie déjà 443 sur l'hôte. Libère-le, ou démarre sur un autre port avec `tale start --port 8443`.
- **Docker ne tourne pas.** `tale start` a besoin du démon Docker en route. Démarre Docker Desktop (ou `sudo systemctl start docker` sous Linux) et réessaie.
- **Un conteneur crash-loope au premier démarrage.** Presque toujours un secret manquant — relance `tale start`, qui relance la configuration d'environnement, ou inspecte les logs avec `tale logs platform`.

## Où ça s'utilise

Tu as maintenant une instance Tale qui marche sur ta machine. Pour la faire tourner pour de vrai, le parcours [Linux serveur](/fr/self-hosted/install/linux-server) couvre TLS, pare-feu, un utilisateur non-root et les crochets opérationnels que tu veux avant que le vrai trafic n'arrive ; [Installation de la CLI](/fr/self-hosted/install/cli-install) configure la CLI pour déployer et mettre à jour une instance distante depuis ta workstation.
