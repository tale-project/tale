---
title: Équipes
description: Regroupe les personnes pour partager des ressources et attribuer les conversations.
---

Les équipes donnent à plusieurs personnes accès au même travail. Le rôle détermine les actions autorisées ; l’appartenance aux équipes contribue à définir les projets, documents, skills et conversations accessibles. Les propriétaires et les admins gèrent les équipes dans **Paramètres > Équipes**.

<Frame caption="Paramètres > Équipes — chaque équipe de l’organisation avec son nombre de membres, à côté de l’action Créer une équipe.">

![La page de paramètres Équipes listant trois équipes — Growth, Platform engineering et Customer success — chacune avec un membre et la date de son ajout, à côté d’un bouton Créer une équipe.](/images/platform/settings-teams.webp)

</Frame>

## Créer une équipe

1. Sélectionne **Créer une équipe** et renseigne le champ **Nom de l'équipe**, par exemple `Support client`.
2. Sélectionne les membres de l’organisation à ajouter. Si tu ne sélectionnes personne, Tale t’ajoute à l’équipe.
3. Sélectionne **Créer une équipe**. Vérifie la nouvelle ligne et le nombre de membres dans la liste.

Choisis un nom reconnaissable dans les sélecteurs d’accès et d’attribution. Le formulaire accepte jusqu’à 80 caractères. Créer une équipe ne lui attribue pas tous les projets ou conversations existants : sélectionne-la sur les ressources qu’elle doit partager.

## Modifier le nom ou les membres

Ouvre la ligne d’une équipe pour consulter ses membres. Son menu propose **Voir**, **Modifier** et **Supprimer**. Utilise **Modifier** pour changer le nom ou les membres, puis enregistre et vérifie le nombre de membres.

Une personne peut appartenir à plusieurs équipes. Elle peut conserver un accès grâce à une autre équipe ou à une attribution directe. La retirer d’une équipe ne supprime donc pas forcément tous ses accès à une ressource. Vérifie les autres voies d’accès lorsque tu retires des droits.

<Tip>

Renomme une équipe existante si son objectif change mais que les mêmes personnes doivent garder leurs accès. La supprimer puis la recréer produit une autre équipe et modifie les attributions des ressources existantes.

</Tip>

## Associer une équipe au travail

| Ressource | Rôle de l’équipe |
| --- | --- |
| Projets | Un projet peut appartenir à une équipe et être partagé avec d’autres. |
| Documents et dossiers | L’accès par équipe limite les lecteurs, en complément des permissions du rôle. |
| Skills | La visibilité par équipe rend un skill disponible aux équipes choisies. |
| Conversations | L’attribution à une équipe place le travail dans sa file. |

Appartenir à une équipe n’autorise pas une action interdite par le rôle. Un Éditeur et un Membre de la même équipe peuvent avoir des droits de modification différents. Les propriétaires et les admins conservent leurs accès d’administration : une équipe ne sert pas à leur masquer du travail.

Pour les conversations entrantes, [les règles de routage](/fr/platform/admin/governance/policies-and-limits#routage-des-conversations) peuvent choisir l’équipe dès l’arrivée. Sans attribution à une personne ou à une équipe, la conversation reste dans le triage des administrateurs.

## Retirer une équipe sans perdre de vue les accès

Avant de supprimer une équipe, examine ses projets, les documents partagés, sa file de conversations et les imports qui lui sont associés. Réattribue le travail dont l’accès doit rester limité. Sélectionne ensuite **Supprimer** dans le menu de la ligne et lis la confirmation.

<Warning>

La suppression d’une équipe est irréversible. Un projet qu’elle possède passe à la première équipe restante avec laquelle il était partagé. S’il n’en reste aucune, le projet devient accessible à toute l’organisation. Vérifie les accès avant la suppression : davantage de personnes pourraient accéder au projet.

</Warning>

Les documents et dossiers perdent l’équipe supprimée dans leur liste d’accès, mais conservent les autres. Une conversation perd son attribution à l’équipe ; si personne ne lui est attribué non plus, elle revient au triage des administrateurs. Les configurations d’import perdent aussi cette association. Les comptes des membres ne sont pas supprimés.

Les équipes synchronisées par [SSO d’entreprise ou SCIM](/fr/platform/admin/enterprise-sso) dépendent aussi des règles du fournisseur d’identité. Vérifie cette source avant de faire une modification locale que tu souhaites conserver.
