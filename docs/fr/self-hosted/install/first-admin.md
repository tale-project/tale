---
title: Créer le premier compte propriétaire
description: Termine la première configuration, vérifie le rôle propriétaire et prépare l’instance pour ton équipe.
---
Sur une instance vide, la configuration Tale crée le premier compte et la première organisation. Ce compte devient Propriétaire. Termine cette étape pendant que tu contrôles encore l’accès à l’instance, avant de partager son adresse.

## Vérifier que l’instance est prête

Ouvre la `SITE_URL` configurée et vérifie le certificat et l’hôte. Pour un déploiement CLI, lance `tale status` ; pour une installation que tu maintiens, inspecte ses services et sondes. Un backend en échec nécessite un [dépannage](/fr/self-hosted/operate/observability/troubleshooting) avant la création du compte.

Une page de connexion au lieu de la configuration indique généralement qu’un compte existe déjà. C’est normal dans un environnement de développement prérempli. Ne supprime pas la base pour récupérer l’accès : connecte-toi au compte existant ou demande une invitation à un admin.

## Terminer la configuration

Ouvre l’URL de l’instance. Suis les étapes pour créer ton compte et nommer l’organisation. Conserve tes identifiants dans un gestionnaire de mots de passe.

Configure le fournisseur de modèles pendant ce parcours ou plus tard sous **Paramètres > Fournisseurs IA**. Sans fournisseur, tu peux explorer l’application ; une vraie réponse exige encore des identifiants valides et un modèle disponible. Suis [Fournisseurs IA](/fr/platform/admin/providers) pour en connecter un.

## Confirmer le rôle propriétaire

Ouvre **Paramètres > Membres** et vérifie que ton compte porte le rôle **Propriétaire**. Le nom de l’organisation et le compte doivent correspondre à l’instance que tu voulais initialiser.

<Frame caption="Vérifie le propriétaire et les rôles des membres invités avant d’ouvrir l’accès à l’équipe.">

![La page des membres de l’organisation affiche les personnes et leurs rôles.](/images/get-started/settings-organization-members.webp)

</Frame>

Déconnecte-toi puis reconnecte-toi pour tester les identifiants indépendamment de la session de configuration. Garde un autre accès administratif de secours déjà vérifié avant de modifier l’authentification.

## Inviter l’équipe

Ajoute les personnes sous **Paramètres > Membres** et choisis leurs rôles délibérément. Après le premier compte, les comptes locaux se créent sur invitation, sans inscription publique. Le SSO d’entreprise et le provisionnement suivent leurs propres [règles de configuration et d’appartenance](/fr/platform/admin/enterprise-sso).

C’est le backend lui-même qui l’applique, pas seulement le proxy placé devant : dès qu’un compte existe, `/api/auth/sign-up/email` répond 403. C’est important, car le backend est aussi joignable depuis le réseau bac à sable des agents, que le proxy ne voit jamais : du code exécuté dans une session d’agent ne peut donc pas créer de comptes non plus. **Paramètres > Membres** crée les comptes côté serveur et n’est pas concerné. Un déploiement de test jetable qui a besoin de la route ouverte définit `TALE_ALLOW_OPEN_SIGN_UP=true` ; jamais sur un déploiement réel.

Utilise [Membres et rôles](/fr/platform/admin/members-and-roles) pour choisir les accès. Puis [crée ton premier agent](/fr/tutorials/editor/first-agent-end-to-end) et teste une vraie réponse. Un Dashboard accessible confirme l’accès à l’application, pas le fournisseur ni chaque service en arrière-plan.
