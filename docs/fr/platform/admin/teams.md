---
title: Équipes
description: Les équipes sont des groupes nommés de membres qui partagent l’accès aux documents, projets, skills et conversations. Les Administrateurs créent et gèrent les équipes sous Paramètres > Équipes ; la frontière qu’elles tracent est la couche de cadrage pour tout ce qui est sous la couche de rôle.
---

Une équipe est un groupe nommé de membres qui partage l’accès aux documents, projets, skills et conversations. Là où les rôles définissent ce qu’une personne _peut_ faire, les équipes définissent dans quelle tranche des données de l’org cette personne travaille. La plupart des orgs finissent avec une poignée d’équipes — support, ventes, opérations — et la plupart des décisions quotidiennes de permission atterrissent sur la frontière équipe, pas sur la frontière rôle. Les Administrateurs gèrent les équipes sous **Paramètres > Équipes**.

Cette page est la référence pour ce qu’une équipe possède, comment marche l’appartenance, et comment la frontière équipe interagit avec les permissions basées sur les rôles documentées sous [Membres et rôles](/fr/platform/admin/members-and-roles). Lis-la une fois quand tu mets les équipes de l’org en place ; reviens quand tu réorganises.

<Frame caption="Paramètres > Équipes — chaque équipe de l’organisation avec son nombre de membres, à côté de l’action Créer une équipe.">

![La page de paramètres Équipes listant trois équipes — Growth, Platform engineering et Customer success — chacune avec un membre et la date de son ajout, à côté d’un bouton Créer une équipe.](/images/platform/settings-teams.webp)

</Frame>

## Ce qu’une équipe possède

Une équipe porte l’appartenance et un ensemble de ressources qui lui sont cadrées. Les ressources sont :

- **Documents et dossiers** — un document ou un dossier cadré sur une équipe n’est visible et éditable que par les membres de cette équipe. Les documents à l’échelle de l’org restent visibles pour quiconque a le bon rôle.
- **Projets** — un projet peut être assigné à une équipe et partagé avec d’autres ; les membres des équipes héritent de l’accès au projet sans être ajoutés un par un.
- **Skills** — un skill enregistré avec visibilité équipe n’apparaît qu’aux membres de ces équipes ; les onglets de la bibliothèque de skills séparent **Organisation**, **Équipes** et **Personnel**.
- **Conversations** — une conversation peut être assignée à une équipe autant qu’à un responsable individuel, depuis le sélecteur d’assignation de son en-tête. La visibilité suit cette assignation : une file d’équipe est visible pour les membres de cette équipe, une assignation personne pour cette personne, et les administrateurs et propriétaires voient tout. Les conversations vraiment non assignées (ni personne ni équipe) restent aux admins pour le triage — associe cela au [Routage des conversations](/fr/platform/admin/governance/policies-and-limits#routage-des-conversations) pour que le courrier entrant atterrisse dans une équipe dès l’arrivée.

Une ressource sans cadre équipe reste visible pour quiconque dont le rôle l’autorise. Les équipes sont une couche de cadrage _additive_ — elles rétrécissent la visibilité, jamais ne l’élargissent.

## Créer une équipe

Ouvre **Paramètres > Équipes** et clique sur **Créer une équipe**. Donne à l’équipe un nom (`Support`, `Ventes`, `Opérations`) et coche ses premiers membres dans la liste — laisse-la vide et tu es ajouté automatiquement, car une équipe doit garder au moins un membre. Le nom apparaît partout où l’équipe surgit : pickers, badges, accès aux documents cadré par équipe et champ d’assignation d’un projet.

La ligne de l’équipe porte les actions du quotidien : **Membres** gère qui est dans l’équipe, **Modifier l'équipe** la renomme, **Supprimer l'équipe** la retire. Ce qu’une équipe peut atteindre découle des endroits où elle est choisie — le cadre d’accès d’un document, l’assignation d’un projet, la visibilité d’un skill.

## Ajouter et retirer des membres

Ouvre la ligne de l’équipe et clique sur **Ajouter des membres**. Le picker liste les membres de l’org ; en cocher un l’ajoute à l’équipe. Un membre peut appartenir à plusieurs équipes ; son accès est l’union de chaque équipe dans laquelle il est plus la portée à l’échelle de l’org de son rôle. Retirer un membre d’une équipe arrache la visibilité cadrée équipe à la requête suivante ; les chats en vol se terminent, mais le thread suivant ne voit pas les ressources de l’équipe.

## Équipe versus rôle

Le rôle décide ce qu’une personne peut faire ; l’équipe décide à quoi elle peut le faire. Un utilisateur de rôle Membre dans l’équipe Support peut lire les documents de l’équipe support mais ne peut pas les éditer ; un utilisateur de rôle Éditeur dans l’équipe Support peut les lire et les écrire mais ne peut pas voir ceux des Ventes. Les équipes n’accordent jamais des capacités que le rôle n’a pas ; les rôles n’élargissent jamais la visibilité au-delà du cadre équipe.

Quand tu as besoin d’une décision de permission que les rôles et équipes existants ne peuvent pas exprimer, le levier suivant est une politique de gouvernance — voir [Membres et rôles](/fr/platform/admin/members-and-roles) pour comment les politiques s’attachent aux rôles, et la section gouvernance pour les champs de politique eux-mêmes.

## Supprimer une équipe

Clique la ligne de l’équipe, puis **Supprimer l'équipe**. La suppression est définitive — l’équipe est partie, tous ses membres en sont retirés, et ils perdent la tranche cadrée équipe de leur accès. Pas d’annulation. Va vers supprimer quand une équipe est vraiment retirée, pas quand elle se réorganise.

## Où cela s’inscrit

Les équipes sont la couche de cadrage juste sous les rôles — les rôles disent _quoi_, les équipes disent _où_. La lecture suivante naturelle dépend de la ressource que tu cadres : [Bibliothèque de skills](/fr/platform/workspace/skills) pour comment une instruction partagée atteint tout le monde, [Connectors (vue Admin)](/fr/platform/admin/connectors) pour les identifiants qu’appellent les automatisations d’une équipe, et [Projets](/fr/platform/projects/overview) pour l’assignation projet-à-équipe.
