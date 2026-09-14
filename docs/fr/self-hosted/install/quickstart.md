---
title: Démarrer ta première instance auto-hébergée
description: Installe la CLI, démarre un projet Tale local et vérifie une première réponse de modèle.
---
Démarre Tale localement avec la CLI, crée le premier compte propriétaire et teste un chat. La CLI prépare le projet et les conteneurs. Tu conserves la configuration et les données persistantes sur l’infrastructure que tu contrôles.

## Préparer la machine locale

Utilise une machine capable d’exécuter Docker avec Compose et disposant d’espace pour les images et les données. La CLI peut aider à installer ou démarrer Docker s’il manque. Le téléchargement initial des images nécessite un accès réseau et peut être long sur une connexion lente.

Un agent a besoin d’identifiants de fournisseur valides avant de répondre. Tu peux les ajouter après la création du compte. Garde cette première instance privée pendant la création du propriétaire.

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

Exécute `tale --version`, dans un nouveau terminal si nécessaire. Si la commande manque, vérifie le répertoire affiché par l’installateur et ajoute-le au `PATH`. Le [guide CLI](/fr/self-hosted/install/cli-install) couvre les versions fixées et l’accès à Docker à distance.

## Initialiser et démarrer

Crée un nouveau répertoire de projet et démarre son environnement local :

```bash
tale init my-project
cd my-project
tale dev
```

`tale init` écrit la configuration et génère les secrets. Garde `.env` privé et conserve-le avec le projet. Examine la question sur Docker dans les sandboxes avant de l’activer : Docker imbriqué avec privilèges modifie les exigences d’isolation de l’hôte.

`tale dev` démarre les services Docker nécessaires et attend leur disponibilité. Ouvre ensuite l’URL qu’il affiche. L’adresse locale par défaut utilise un certificat autosigné ; vérifie qu’il s’agit bien de ta propre instance avant d’accepter l’avertissement du navigateur.

<Note>

Le répertoire généré `default/` contient des exemples de catalogue et des entrées installées automatiquement. Modifier un exemple ne change pas forcément une organisation existante. Lis son `README.md` avant de compter sur le rechargement de configuration.

</Note>

Laisse `tale dev` tourner pendant l’utilisation. `Ctrl-C` arrête l’exécution au premier plan ; `tale dev --detach` démarre en arrière-plan. Arrêter les conteneurs ne supprime pas leurs données persistantes.

## Créer le propriétaire et tester une réponse

Sur une instance vide, termine la création du compte et de l’organisation. Vérifie le rôle **Propriétaire** sous **Paramètres > Membres** avec [Premier compte propriétaire](/fr/self-hosted/install/first-admin).

Connecte un fournisseur pendant la configuration ou sous **Paramètres > Fournisseurs IA**, puis suis [Créer ton premier agent](/fr/tutorials/editor/first-agent-end-to-end). Un identifiant enregistré ne suffit pas : envoie un message et examine la réponse terminée pour vérifier le fournisseur, le modèle et l’exécution.

## Résoudre les problèmes de démarrage

| Symptôme | Action suivante |
| --- | --- |
| `tale` est introuvable | Vérifie le répertoire d’installation et le `PATH` du terminal. |
| Docker ne démarre pas | Ouvre Docker Desktop ou démarre le daemon, puis réessaie. |
| Une image se télécharge lentement ou échoue | Lis le nom de l’image et l’erreur réseau ; vérifie le registre et l’espace disque. |
| Le port HTTPS est occupé | Identifie le processus ou utilise `tale dev --port 8443`. Seul le port HTTPS change. |
| Un conteneur redémarre en boucle | Lis `tale status` et `tale logs <service>`, puis corrige la cause signalée. |
| L’application s’ouvre sans réponse du modèle | Vérifie les identifiants et le modèle, puis les logs backend et sandbox. |

Le spawner sandbox utilise `127.0.0.1:8003`. Changer uniquement le port HTTPS n’isole donc pas deux projets locaux.

## Préparer la production

`tale deploy` applique la configuration du projet sur l’hôte Docker choisi. Prépare DNS, TLS, sauvegardes et contrôles d’accès avant d’inviter l’équipe. Réutiliser le répertoire du projet ne transfère pas automatiquement les bases ou les fichiers vers un autre hôte.

Lis [TLS et domaines](/fr/self-hosted/configuration/tls-and-domains), [Sauvegardes et restauration](/fr/self-hosted/operate/backups-and-restore) et [Renforcement](/fr/self-hosted/operate/security/hardening). Pour une installation gérée directement par ton équipe, utilise [Exécuter ton propre Compose](/fr/self-hosted/install/own-compose).
