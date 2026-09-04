---
title: Démarrage rapide auto-hébergé
description: Fais tourner une instance Tale sur ta machine — installe la CLI tale, puis deux commandes, et l’assistant de configuration fait de toi le Propriétaire.
---

C’est le chemin le plus rapide vers un Tale qui tourne : installe la CLI `tale`, puis deux commandes. Le résultat est ta propre organisation sur ta propre machine, joignable dans le navigateur. C’est pensé pour un laptop ou un hôte unique sur lequel essayer Tale ; quand tu veux le faire tourner pour de vrai, le parcours [serveur Linux](/fr/self-hosted/install/linux-server) couvre une installation de production durcie.

## Avant de commencer

Il ne te faut rien pour démarrer, et une chose avant qu’un agent puisse répondre :

- **Docker** — mais la CLI le provisionne pour toi : s’il manque, `tale dev` propose de l’installer ou de le démarrer avant toute autre chose. Si tu fais déjà tourner [Docker Desktop](https://www.docker.com/products/docker-desktop) (v24+), ou Docker Engine plus le plugin Compose sous Linux, la CLI s’en sert.
- Une **[clé API OpenRouter](https://openrouter.ai)** (ou n’importe quel fournisseur compatible OpenAI) pour que les agents aient un modèle à qui parler. Tu n’en as pas besoin pour `tale init` — tu l’ajoutes dans l’app après l’inscription, dans l’assistant de configuration ou sous **Paramètres > Fournisseurs IA**, et tu peux changer de fournisseur plus tard.

## De zéro à connecté

<Steps>

<Step title="Installe la CLI">

L’installateur détecte ton OS, dépose le binaire `tale` sur ton `PATH`, et c’est la seule étape qui touche ton système — il demande `sudo` quand le répertoire d’installation (par défaut `/usr/local/bin`) n’est pas accessible en écriture.

<Tabs>

<Tab title="macOS / Linux">

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

</Tab>

<Tab title="Windows (PowerShell)">

```powershell
irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

</Tab>

</Tabs>

<Check>

`tale --version` qui imprime un numéro de version confirme que le binaire a atterri sur ton `PATH`.

</Check>

</Step>

<Step title="Crée un projet">

```bash
tale init my-project
cd my-project
```

`tale init` échafaude un répertoire de projet, génère chaque secret de sécurité et écrit le `.env`, de sorte qu’il n’y a rien à éditer à la main. Les valeurs par défaut sont localhost et un certificat auto-signé ; le domaine de production se choisit plus tard, à `tale deploy`. La seule question qu’il pose est de savoir si les agents peuvent lancer `docker` / `docker compose` dans leurs sandboxes — le défaut est non, car l’activer fait tourner un Docker interne privilégié ; une installation mono-utilisateur peut dire oui, un opérateur multi-tenant installe plutôt Sysbox. Il ne demande pas de clé API ; celle-ci est collectée dans l’app une fois que tu es connecté. Il dépose aussi des agents, workflows, connectors, fournisseurs, skills et branding d’exemple sous `default/`, et écrit `AGENTS.md` (plus un pointeur `CLAUDE.md`) afin qu’un éditeur IA puisse construire des configurations en pleine connaissance du schéma. L’essentiel de cette arborescence est un catalogue, pas une configuration active : sur une nouvelle organisation, seules les entrées marquées `autoInstall` sont actives — le `default/README.md` généré explique la différence.

</Step>

<Step title="Démarre Tale">

```bash
tale dev
```

Si Docker manque, `tale dev` propose d’abord de l’installer ou de le démarrer. Le premier passage récupère ensuite plusieurs gigaoctets d’images et construit le graphe de conteneurs — la CLI affiche la progression du pull image par image et continue d’attendre ; sur un réseau lent, ça peut prendre des dizaines de minutes. Dès que la stack se signale prête (`Tale is running — open https://localhost`), `tale dev` ouvre ton navigateur automatiquement. S’il ne peut pas, il imprime l’URL à visiter.

<Note>

Ton navigateur affiche un avertissement de certificat pour le certificat local auto-signé. C’est attendu — accepte-le pour continuer.

</Note>

Ta configuration sous `default/` est montée dans l’instance en marche, donc les modifications d’agents, de workflows et d’connectors rechargent à chaud. Arrête la stack avec `Ctrl-C` (ou `tale dev --detach` pour la laisser tourner en arrière-plan).

</Step>

<Step title="Crée ton compte">

Sur une instance vide, il n’y a pas de page d’inscription à chercher : la première visite atterrit dans l’assistant de configuration unique, qui crée ton compte, te connecte, fait de toi le **Propriétaire** et nomme ton **Organisation**. Tu atterris dans le dashboard — aucune clé admin en jeu, et rien à verrouiller ensuite, car tous ceux qui te suivent arrivent par invitation.

<Note>

[Premier admin](/fr/self-hosted/install/first-admin) couvre l’assistant en détail et comment les coéquipiers arrivent.

</Note>

</Step>

<Step title="Ajoute un modèle et publie un agent">

Tu as maintenant une organisation vide. Deux gestes t’amènent à quelque chose d’utile : ajoute ta clé OpenRouter — l’assistant de configuration la demande juste après la création du compte propriétaire, et **Paramètres > Fournisseurs IA** la prend à tout moment — puis [construis ton premier agent](/fr/tutorials/editor/first-agent-end-to-end). Une confirmation sur la ligne du fournisseur signifie que la clé fonctionne.

<Check>

Un nouveau chat qui répond à un message est la preuve de bout en bout : fournisseur, modèle et agent fonctionnent tous. À partir d’ici, la doc [Plateforme](/fr/platform) est la référence canonique de chaque fonctionnalité, identique à Cloud.

</Check>

</Step>

</Steps>

## Plutôt du Docker Compose brut ?

La CLI enveloppe `docker compose` pour que tu n’aies pas à le faire. Si tu préfères faire tourner la stack depuis un clone du dépôt et gérer Compose toi-même — pour la transparence, des builds air-gapped ou ta propre automatisation — clone le dépôt, copie `.env.example` vers `.env`, règle `HOST` et `SITE_URL`, génère les secrets et lance `docker compose up -d`. Le parcours [serveur Linux](/fr/self-hosted/install/linux-server) et la [référence Docker Compose](/fr/self-hosted/install/docker-compose-reference) couvrent ce chemin de bout en bout.

## Dépannage

- **`tale` introuvable après l’installation.** L’installateur nomme le répertoire de destination dans sa sortie ; assure-toi que ce répertoire est sur ton `PATH` (sous Linux, c’est généralement `/usr/local/bin`).
- **`tale dev` se termine sur un conflit de port.** Lis l’erreur compose pour voir quel port est pris. Si c’est 443, un autre service lie HTTPS sur l’hôte — libère-le, ou déplace Tale avec `tale dev --port 8443` (l’option ne déplace que le port HTTPS). Le spawner de sandbox lie toujours `127.0.0.1:8003` et ne peut pas être déplacé ; deux projets Tale en dev ne peuvent donc pas tourner en même temps sur une machine.
- **Docker ne tourne pas.** `tale dev` propose de le démarrer (ou de l’installer) — accepte l’invite, ou démarre Docker Desktop toi-même (`sudo systemctl start docker` sous Linux) et réessaie.
- **Un conteneur crash-loope au premier démarrage.** Presque toujours un secret manquant — relance `tale dev`, qui relance la configuration d’environnement, ou inspecte les logs avec `tale logs platform`.

## Où ça s’utilise

Tu as maintenant une instance Tale qui fonctionne sur ta machine. Pour la faire tourner pour de vrai, le parcours [serveur Linux](/fr/self-hosted/install/linux-server) couvre TLS, pare-feu, un utilisateur non-root et les crochets opérationnels que tu veux avant que le vrai trafic n’arrive ; [Installer la CLI tale](/fr/self-hosted/install/cli-install) prépare la CLI à déployer et mettre à jour une instance distante depuis ta machine de travail.
