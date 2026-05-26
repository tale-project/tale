---
title: Administrer
description: Paramètres au niveau de l'organisation — membres et rôles, fournisseurs, image de marque, gouvernance, double facteur, analyse d'usage, demandes des personnes concernées et le changelog in-app.
---

L'administration est la partie de Tale qui reste invisible jusqu'à ce que quelque chose tourne mal. C'est là que tu décides qui peut se connecter et via quel fournisseur d'identité, quels modèles IA le reste de l'organisation est autorisé à consommer, à quoi ressemble le produit vu de l'extérieur, et combien de temps conversations et journaux survivent sur disque. Aucune de ces décisions n'est quotidienne, mais chacune surgit dans le quotidien de quelqu'un d'autre dès qu'elle est mal réglée — un Développeur qui n'atteint plus Anthropic, un Éditeur dont les brouillons ont disparu, un Membre verrouillé après la migration SSO.

Les pages de cette section sont destinées aux rôles **Admin** et **Propriétaire** ; tous les autres rôles sont bloqués côté serveur sur la surface d'administration. Leur ordre n'est pas anodin. [Membres et rôles](/fr/platform/admin/members-and-roles) se lit en premier, parce que rien d'autre en administration n'a de réponse sensée tant que tu n'as pas décidé qui peut faire quoi. [Authentification](/fr/self-hosted/admin/authentication) vient ensuite, puisque la question de _qui peut se connecter du tout_ est une version plus stricte de la même question. Les fournisseurs, l'image de marque, la gouvernance et le reste se posent par-dessus.

Si tu mets en place une organisation neuve, lis les pages dans l'ordre de la barre latérale. Si tu auditionnes une organisation existante, saute directement à la page dont tu as déjà l'interface ouverte.

## Pages dans cette section

- **[Membres et rôles](/fr/platform/admin/members-and-roles)** — inviter, modifier et retirer des membres ; la matrice canonique des six rôles vers laquelle le reste de la doc renvoie.
- **[Équipes](/fr/platform/admin/teams)** — regrouper les membres pour borner l'accès aux documents, conversations et connaissances d'agent.
- **[Authentification](/fr/self-hosted/admin/authentication)** — mot de passe, Microsoft Entra ID SSO et en-têtes de reverse-proxy de confiance ; comment Tale décide qu'une connexion passe.
- **[Fournisseurs IA](/fr/platform/admin/providers)** — connecter Tale à des points de terminaison compatibles OpenAI et décider quels modèles l'organisation peut appeler.
- **[Image de marque](/fr/platform/admin/branding)** — nom de l'application, logo, favicon et les couleurs de marque et d'accentuation utilisées dans l'application en cours d'exécution.
- **[Gouvernance](/fr/platform/admin/governance)** — system prompt, modèles par défaut, budgets, politique de téléversement, rétention, politique de mot de passe et de connexion, contrôle des fonctionnalités et la pile de garde-fous à trois étages.
- **[Authentification à double facteur](/fr/platform/admin/two-factor-authentication)** — inscrire un TOTP, gérer les codes de secours, faire appliquer la politique au niveau de l'organisation, réinitialiser un membre qui a perdu son appareil.
- **[Analyse d'usage](/fr/platform/admin/usage-analytics)** — analyse des tokens, du coût et des exécutions, filtrée par équipe, utilisateur, agent et plage temporelle.
- **[Demandes des personnes concernées](/fr/platform/admin/data-subject-requests)** — déposer des demandes RGPD Art. 17 d'effacement, avec suivi SLA et reçu chaîné au journal d'audit.
- **[Nouveautés](/fr/platform/admin/changelog)** — le visualisateur de changelog in-app qui fait remonter les notes de version après chaque mise à niveau.
