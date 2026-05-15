---
title: Administrer
description: Paramètres au niveau de l'organisation — membres, authentification, fournisseurs, image de marque, gouvernance, analytique.
---

L'administration, c'est la partie de Tale qui reste invisible jusqu'à ce que quelque chose tourne mal. C'est là que tu décides qui peut se connecter et via quel fournisseur d'identité, quels modèles IA le reste de l'organisation est autorisé à consommer, à quoi ressemble le produit vu de l'extérieur, et combien de temps les conversations et les journaux restent sur disque. Aucune de ces décisions n'est quotidienne, mais chacune surgit dans le quotidien de quelqu'un d'autre dès qu'elle est mal réglée — une développeuse qui n'atteint plus Anthropic, un Éditeur dont les brouillons ont disparu, un Membre qui ne peut plus se connecter après la migration SSO.

Les pages de cette section sont destinées aux rôles **Admin** et **Propriétaire** ; les autres rôles ne voient pas du tout la surface d'administration. Leur ordre n'est pas anodin. [Membres et rôles](/fr/platform/admin/members-and-roles) se lit en premier, parce que rien d'autre en administration n'a de sens sans la réponse à « qui peut faire quoi ? ». [Authentification](/fr/self-hosted/admin/authentication) suit, puisque la question _qui peut se connecter tout court_ est une version plus stricte de la même question. La configuration des Fournisseurs IA, l'image de marque, la gouvernance et le reste se posent par-dessus.

Si tu mets en place une organisation toute neuve, lis les pages dans l'ordre de la barre latérale. Si tu auditionnes une organisation existante, saute directement à la page dont tu as déjà l'interface ouverte.

## Pages dans cette section

- [Membres et rôles](/fr/platform/admin/members-and-roles) — qui peut faire quoi, et comment ajouter ou retirer des membres.
- [Équipes](/fr/platform/admin/teams) — regrouper les membres pour partager l'accès aux agents et aux connaissances.
- [Authentification](/fr/self-hosted/admin/authentication) — mot de passe, SSO (Microsoft Entra), en-têtes de reverse-proxy de confiance.
- [Fournisseurs IA](/fr/platform/admin/providers) — les modèles IA disponibles dans l'organisation.
- [Image de marque](/fr/platform/admin/branding) — logo, couleurs, fond d'écran de connexion, nom du produit.
- [Gouvernance](/fr/platform/admin/governance) — rétention, demandes des personnes concernées, journal d'audit.
- [Authentification à deux facteurs](/fr/platform/admin/two-factor-authentication) — TOTP et codes de récupération.
- [Analytique d'usage](/fr/platform/admin/usage-analytics) — activité par utilisateur et à l'échelle de l'organisation.
- [Nouveautés](/fr/platform/admin/changelog) — le visualisateur de changelog in-app pour la communication des notes de version.
