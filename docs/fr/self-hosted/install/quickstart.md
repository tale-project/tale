---
title: Démarrage rapide auto-hébergé
description: Fais tourner une instance Tale sur ta machine — installe la CLI tale, puis deux commandes, et l'assistant de configuration fait de toi l'Owner.
---

C'est le chemin le plus rapide vers un Tale qui tourne : installe la CLI `tale`, puis deux commandes. Le résultat est ta propre organisation qui tourne sur ta propre machine, joignable dans le navigateur. C'est pensé pour un laptop ou un hôte unique sur lequel tu veux essayer Tale ; quand tu es prêt à le faire tourner pour de vrai, le parcours [Linux serveur](/fr/self-hosted/install/linux-server) couvre une installation de production durcie.

Il ne te faut rien pour démarrer, et une chose avant qu'un agent puisse répondre :

- **Docker** — mais la CLI le provisionne pour toi : s'il manque, `tale dev` propose de l'installer ou de le démarrer avant toute autre chose. Si tu fais déjà tourner [Docker Desktop](https://www.docker.com/products/docker-desktop) (v24+), ou Docker Engine plus le plugin Compose sous Linux, la CLI s'en sert.
- Une **[clé API OpenRouter](https://openrouter.ai)** (ou n'importe quel fournisseur compatible OpenAI) pour que les agents aient un modèle à qui parler. Tu n'en as pas besoin pour `tale init` — tu l'ajoutes dans l'app, dans l'assistant de configuration ou sous **Paramètres > Fournisseurs IA**, et tu pourras brancher n'importe quel fournisseur plus tard.

## Étape 1 — Installer la CLI

Sous macOS ou Linux :

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

Sous Windows (PowerShell) :

```powershell
irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

L'installateur détecte ton OS, dépose le binaire `tale` sur ton `PATH`, et c'est la seule étape qui touche ton système — il demande `sudo` quand le répertoire d'installation (par défaut `/usr/local/bin`) n'est pas accessible en écriture. Confirme qu'il a atterri :

```bash
tale --version
```

## Étape 2 — Créer un projet

```bash
tale init my-project
cd my-project
```

`tale init` échafaude un répertoire de projet, génère chaque secret de sécurité et écrit le `.env`, de sorte qu'il n'y a rien à éditer à la main. Les valeurs par défaut sont localhost et un certificat auto-signé ; le domaine de production se choisit plus tard, à `tale deploy`. La seule question qu'il pose est de savoir si les agents peuvent lancer `docker` / `docker compose` dans leurs sandboxes — le défaut est non, car l'activer fait tourner un Docker interne privilégié ; une installation mono-utilisateur peut dire oui, un opérateur multi-tenant installe plutôt Sysbox. Il ne demande pas de clé API ; celle-ci est collectée dans l'app une fois que tu es connecté. Il dépose aussi des agents, workflows, intégrations, fournisseurs, skills et branding d'exemple sous `default/`, et écrit `AGENTS.md` (plus un pointeur `CLAUDE.md`) afin qu'un éditeur IA puisse construire des configurations en pleine connaissance du schéma.

## Étape 3 — Démarrer Tale

```bash
tale dev
```

Si Docker manque, `tale dev` propose d'abord de l'installer ou de le démarrer. Le premier passage récupère ensuite plusieurs gigaoctets d'images et construit le graphe de conteneurs — la CLI affiche la progression du pull image par image et continue d'attendre ; sur un réseau lent, ça peut prendre des dizaines de minutes. Dès que la stack se signale prête (`Tale is running — open https://localhost`), `tale dev` ouvre ton navigateur automatiquement. S'il ne peut pas, il imprime l'URL à visiter.

> Ton navigateur affiche un avertissement de certificat pour le certificat auto-signé local. C'est attendu — accepte-le pour continuer.

Ta configuration sous `default/` est montée dans l'instance en marche, donc les édits aux agents, workflows et intégrations rechargent à chaud. Arrête la stack avec `Ctrl-C` (ou `tale dev --detach` pour la faire tourner en arrière-plan).

## Étape 4 — Dérouler l'assistant de configuration

Sur une instance vide, il n'y a pas de page d'inscription à chercher : la première visite atterrit dans l'assistant de configuration unique, qui crée ton compte, te connecte, fait de toi l'**Owner** et nomme ton **Organisation**. Tu atterris dans le dashboard — aucune clé admin en jeu, et rien à verrouiller ensuite, car tous ceux qui te suivent arrivent par invitation.

> [Premier admin](/fr/self-hosted/install/first-admin) couvre l'assistant en détail, comment les coéquipiers arrivent, et la clé admin du tableau de bord Convex — un outil d'inspection du backend qui ne joue aucun rôle dans la connexion.

## Étape 5 — Ajouter un modèle et publier un agent

Tu as maintenant une organisation vide. Deux gestes t'amènent à quelque chose d'utile :

1. Ajoute ta clé OpenRouter. L'assistant de configuration la demande juste après la création du compte owner ; si tu l'as sautée, ouvre **Paramètres > Fournisseurs IA** et colle-la là. Une coche sur la ligne du fournisseur signifie que la clé marche.
2. Publie ton premier agent — [Créer un agent](/fr/platform/agents/create) le mène d'un rôle et de quelques instructions à un spécialiste fonctionnel.

À partir de là, la doc [Platform](/fr/platform) est la référence canonique pour chaque fonctionnalité, et elle est identique à Cloud.

## Plutôt du Docker Compose brut ?

La CLI enveloppe `docker compose` pour que tu n'aies pas à le faire. Si tu préfères faire tourner la stack depuis un clone du dépôt et gérer Compose toi-même — pour la transparence, des builds air-gapped ou ta propre automation — clone le dépôt, copie `.env.example` vers `.env`, règle `HOST` et `SITE_URL`, génère les secrets et `docker compose up -d`. Le parcours [Linux serveur](/fr/self-hosted/install/linux-server) et la [référence Docker Compose](/fr/self-hosted/install/docker-compose-reference) couvrent ce chemin de bout en bout.

## Dépannage

- **`tale` introuvable après l'installation.** L'installateur nomme le répertoire de destination dans sa sortie ; assure-toi que ce répertoire est sur ton `PATH` (sous Linux, c'est généralement `/usr/local/bin`).
- **`tale dev` se termine sur un conflit de port.** Lis l'erreur compose pour voir quel port est pris. Si c'est 443, un autre service lie HTTPS sur l'hôte — libère-le, ou déplace Tale avec `tale dev --port 8443` (l'option ne déplace que le port HTTPS). Le spawner de sandbox lie toujours `127.0.0.1:8003` et ne peut pas être déplacé ; deux projets Tale en dev ne peuvent donc pas tourner en même temps sur une machine.
- **Docker ne tourne pas.** `tale dev` propose de le démarrer (ou de l'installer) — accepte l'invite, ou démarre Docker Desktop toi-même (`sudo systemctl start docker` sous Linux) et réessaie.
- **Un conteneur crash-loope au premier démarrage.** Presque toujours un secret manquant — relance `tale dev`, qui relance la configuration d'environnement, ou inspecte les logs avec `tale logs platform`.

## Où ça s'utilise

Tu as maintenant une instance Tale qui marche sur ta machine. Pour la faire tourner pour de vrai, le parcours [Linux serveur](/fr/self-hosted/install/linux-server) couvre TLS, pare-feu, un utilisateur non-root et les crochets opérationnels que tu veux avant que le vrai trafic n'arrive ; [Installation de la CLI](/fr/self-hosted/install/cli-install) configure la CLI pour déployer et mettre à jour une instance distante depuis ta workstation.
