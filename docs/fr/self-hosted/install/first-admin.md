---
title: Créer le premier compte propriétaire
description: Termine la première configuration, vérifie le rôle propriétaire et prépare l’instance pour ton équipe.
---
Sur une instance vide, la configuration Tale crée le premier compte et la première organisation. Ce compte devient Propriétaire. Termine cette étape pendant que tu contrôles encore l’accès à l’instance, avant de partager son adresse.

## Vérifier que l’instance est prête

Ouvre l’adresse affichée par `tale dev`, ou la `SITE_URL` configurée pour un déploiement, et vérifie le certificat et l’hôte. Pour un déploiement CLI, lance `tale status` ; pour une installation que tu maintiens, inspecte ses services et sondes. Un backend en échec nécessite un [dépannage](/fr/self-hosted/operate/observability/troubleshooting) avant la création du compte.

Une page de connexion au lieu de la configuration indique généralement qu’un compte existe déjà. C’est normal dans un environnement de développement prérempli. Ne supprime pas la base pour récupérer l’accès : connecte-toi au compte existant ou demande à un admin d’ajouter ton compte.

## Terminer la configuration

Ouvre l’URL de l’instance. Suis les étapes pour créer ton compte et nommer l’organisation. Conserve tes identifiants dans un gestionnaire de mots de passe.

Après avoir créé le compte et l’organisation, utilise le lien vers les fournisseurs sur la dernière page de l’assistant ou ouvre **Paramètres > Fournisseurs IA**. Sans fournisseur, tu peux explorer l’application ; une vraie réponse exige encore des identifiants valides et un modèle disponible. Suis [Fournisseurs IA](/fr/platform/admin/providers) pour en connecter un.

## Confirmer le rôle propriétaire

Ouvre **Paramètres > Membres** et vérifie que ton compte porte le rôle **Propriétaire**. Le nom de l’organisation et le compte doivent correspondre à l’instance que tu voulais initialiser.

<Frame caption="Vérifie le propriétaire et les rôles des membres avant d’ouvrir l’accès à l’équipe.">

![La page des membres de l’organisation affiche les personnes et leurs rôles.](/images/get-started/settings-organization-members.webp)

</Frame>

Déconnecte-toi puis reconnecte-toi pour tester les identifiants indépendamment de la session de configuration. Garde un autre accès administratif de secours déjà vérifié avant de modifier l’authentification.

## Ajouter l’équipe {#inviter-lequipe}

Ajoute les personnes sous **Paramètres > Membres** et choisis leurs rôles délibérément. Pour un nouveau compte, le formulaire définit un mot de passe initial ; un compte existant conserve ses identifiants. Cette procédure n’envoie aucun e-mail d’invitation. Transmets les identifiants initiaux par un canal sécurisé. L’inscription publique se ferme après le premier compte. Le SSO d’entreprise et le provisionnement suivent leurs propres [règles de configuration et d’appartenance](/fr/platform/admin/enterprise-sso).

C’est le backend lui-même qui l’applique, pas seulement le proxy placé devant : dès qu’un compte existe, `/api/auth/sign-up/email` répond 403. C’est important, car le backend est aussi joignable depuis le réseau bac à sable des agents, que le proxy ne voit jamais : du code exécuté dans une session d’agent ne peut donc pas créer de comptes non plus. **Paramètres > Membres** crée les comptes côté serveur et n’est pas concerné. Un déploiement de test jetable qui a besoin de la route ouverte définit `TALE_ALLOW_OPEN_SIGN_UP=true` ; jamais sur un déploiement réel.

Toute personne connectée peut créer une organisation supplémentaire tant que tu ne désignes pas qui en a le droit : définis `TALE_ORGANIZATION_CREATORS` avec leurs adresses de connexion, et l’entrée **Créer une organisation** disparaît du choix d’organisation pour toutes les autres personnes, que l’API refuse avec `403 ORGANIZATION_CREATION_FORBIDDEN`. La première organisation est toujours autorisée, la configuration initiale n’est donc pas concernée. Un déploiement géré déclare la même liste sous `organizations.creators` dans sa spécification ; voir [Installer la CLI tale](/fr/self-hosted/install/cli-install#managed-organization-creators) et la [référence des variables d’environnement](/fr/self-hosted/configuration/environment-reference).

Utilise [Membres et rôles](/fr/platform/admin/members-and-roles) pour choisir les accès. Puis [envoie ton premier message](/fr/get-started/quickstart) et vérifie la réponse complète. Crée un [agent de projet](/fr/tutorials/editor/first-agent-end-to-end) quand tu souhaites déléguer une tâche. Un Dashboard accessible confirme l’accès à l’application, pas le fournisseur ni chaque service en arrière-plan.
