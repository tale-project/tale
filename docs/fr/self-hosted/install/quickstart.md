---
title: Démarrer ta première instance auto-hébergée
description: Installe la CLI, démarre Tale localement, crée ton compte propriétaire et vérifie une première réponse dans le chat.
---
Démarre Tale localement avec la CLI publiée, puis crée ton espace de travail et envoie un message. Tu n’as pas besoin de cloner le dépôt, d’installer Bun ou de compiler l’application. La CLI télécharge les images des conteneurs et prépare la configuration.

## Préparer la machine locale

Il te faut :

- macOS, Linux ou Windows avec PowerShell, ainsi que Docker exécutant des conteneurs Linux avec Compose. Docker Desktop inclut Compose sur macOS et Windows. Si Docker manque, `tale dev` propose de t’aider à l’installer.
- Un accès réseau à GitHub pour la CLI et aux registres de conteneurs pour les images. Le premier démarrage télécharge plusieurs Go ; prévois de la place pour les images et tes données.
- Les identifiants d’un fournisseur de modèles compatible pour tester la première réponse. Tu peux créer ton compte et explorer l’application avant de connecter un fournisseur.

Sur ARM64, y compris Apple Silicon, le stockage objet fourni nécessite l’émulation amd64. Docker Desktop l’inclut ; sur un hôte Linux avec Docker autonome, tu dois la configurer séparément. Vérifie les [prérequis d’architecture](/fr/self-hosted/install/cli-install#avant-de-commencer) avant de démarrer sur ARM64 Linux.

Le port HTTPS par défaut est `443` ; le service sandbox utilise aussi `127.0.0.1:8003`. Garde l’instance privée jusqu’à la création de son compte propriétaire.

## Installer la CLI

Choisis l’installateur adapté à ton système :

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

Vérifie l’installation avec `tale --version` dans le même terminal. Si la commande est introuvable, suis les indications de l’installateur pour le `PATH` et rouvre les terminaux déjà ouverts. Le [guide CLI](/fr/self-hosted/install/cli-install) couvre les versions fixées et le choix du répertoire d’installation.

Consulte `tale --help` avant d’utiliser `tale doctor`. Si `doctor` n’y figure pas, lance `docker info` et `docker compose version` pour vérifier Docker et Compose. Lorsqu’elle est disponible, la commande `tale doctor` examine aussi l’architecture des conteneurs et les ports locaux sans installer de logiciel ni modifier de fichiers. Suis les solutions proposées ; un résultat positif ne vérifie ni les téléchargements d’images ni l’accès aux modèles.

## Initialiser et démarrer

Choisis où conserver ton projet, puis exécute :

```bash
tale init my-project
cd my-project
tale dev
```

`tale init` crée le projet et un fichier `.env` privé contenant les secrets générés. Sauvegarde ce fichier et ses clés de chiffrement en lieu sûr. À la question sur Docker dans les sandboxes, conserve le choix désactivé par défaut tant que tes agents n’ont pas besoin de Docker : son activation autorise Docker imbriqué avec privilèges.

`tale dev` démarre les conteneurs et affiche l’adresse lorsque l’application est prête. Laisse la commande tourner pendant les premiers téléchargements et la préparation de la base de données. Ouvre l’URL affichée, normalement `https://localhost`. Le certificat local est autosigné ; vérifie que l’adresse correspond à ta propre instance avant d’accepter l’avertissement du navigateur.

<Note>

Le répertoire généré `default/` contient des exemples de catalogue et des entrées installées automatiquement. Tu n’as pas besoin de le modifier pour ce premier démarrage. Son `README.md` explique quelles modifications de configuration affectent une organisation.

</Note>

## Créer le propriétaire et tester une réponse

1. Suis l’assistant pour créer ton compte et nommer l’organisation. Ce premier compte devient son **Propriétaire**. [Premier compte propriétaire](/fr/self-hosted/install/first-admin) explique comment vérifier ce rôle et utiliser un compte existant.
2. Après la configuration, ouvre **Paramètres > Fournisseurs IA** et ajoute des identifiants compatibles. La dernière page de l’assistant mène aussi aux paramètres des fournisseurs. Consulte [Fournisseurs IA](/fr/platform/admin/providers) pour les champs et les méthodes d’authentification prises en charge.
3. Ouvre **Accueil**, choisis **Nouveau chat**, sélectionne un modèle disponible et envoie une courte demande, par exemple « Écris une liste de trois points pour préparer une réunion. » Attends la fin de la réponse.

Une réponse complète confirme que le compte, le fournisseur et le modèle choisi fonctionnent ensemble. Si la liste des modèles est vide ou que la demande échoue, consulte les solutions du guide des fournisseurs. [Envoyer ton premier message](/fr/get-started/quickstart) explique comment poursuivre et retrouver la conversation. Quand tu souhaites déléguer du travail dans un projet, [crée ton premier agent](/fr/tutorials/editor/first-agent-end-to-end).

## Arrêter et reprendre plus tard

Appuie sur `Ctrl-C` dans le terminal qui exécute `tale dev` pour arrêter l’instance au premier plan. Relance `tale dev` depuis le même répertoire de projet pour reprendre avec les données existantes.

Consulte `tale dev --help` avant d’utiliser les commandes ci-dessous pour le fonctionnement en arrière-plan. Si `--stop` n’y figure pas, garde `tale dev` au premier plan et arrête-le avec `Ctrl-C`.

```bash
tale dev --detach
tale dev --stop
```

L’arrêt conserve le projet, les secrets et les données persistantes. Continue à utiliser le même répertoire ; créer un nouveau projet démarre une instance distincte.

## Résoudre les problèmes de démarrage

| Symptôme | Action suivante |
| --- | --- |
| `tale` est introuvable | Vérifie le répertoire d’installation et le `PATH` ; sous Windows, ouvre un nouveau terminal. |
| Docker ne démarre pas | Ouvre Docker Desktop ou démarre le daemon. Vérifie que `docker info` fonctionne dans le même terminal, puis réessaie. |
| Compose manque | Vérifie `docker compose version` ; installe le plugin Compose ou mets Docker Desktop à jour. |
| Une image se télécharge lentement ou échoue | Vérifie l’erreur réseau ou du registre et l’espace disque libre. Après correction, relance `tale dev` dans le même répertoire. |
| Le port HTTPS est occupé | Vérifie quel processus utilise le port `443`. Avec la CLI publiée en version v0.5.70, libère ce port avant de réessayer. |
| Le port `8003` est occupé | Arrête l’autre instance Tale locale ou le service qui utilise ce port. `--port` ne change que HTTPS. |
| Un conteneur redémarre en boucle | Lance `tale status`, puis `tale logs backend-api --tail 100` ou `tale logs platform --tail 100`. Cherche la cause dans les logs du service signalé. |
| La connexion apparaît à la place de la configuration initiale | Un compte existe déjà. Connecte-toi avec ce compte ; ne réinitialise pas les données pour répéter la configuration. |
| L’application s’ouvre sans réponse du modèle | Vérifie les identifiants et le modèle choisi sous **Paramètres > Fournisseurs IA**. |

Réessaie après avoir corrigé la cause signalée ; conserve `.env` et les volumes de données. Si le problème persiste, suis le guide de [dépannage](/fr/self-hosted/operate/observability/troubleshooting) et indique la version de la CLI ainsi que l’erreur pertinente dans ta demande d’aide. Retire les identifiants des logs avant de les partager.

## Préparer la production

`tale deploy` applique la configuration du projet sur l’hôte Docker choisi. Le développement et le déploiement utilisent des volumes distincts : le compte local, les chats et les fichiers téléversés ne sont pas transférés. Prépare DNS, TLS, sauvegardes et contrôles d’accès avant d’ajouter ton équipe.

Lis [TLS et domaines](/fr/self-hosted/configuration/tls-and-domains), [Sauvegardes et restauration](/fr/self-hosted/operate/backups-and-restore) et [Renforcement](/fr/self-hosted/operate/security/hardening). Si tu dois maintenir toi-même les définitions des services, utilise [Exécuter ton propre Compose](/fr/self-hosted/install/own-compose).
