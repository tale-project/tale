---
title: Équipes
description: Regroupe les personnes pour décider qui voit les documents, projets et files d’équipe.
---

Une équipe est une étiquette posée sur le travail, pas un espace dans lequel on bascule. Un document, un dossier ou un projet porte les équipes qui peuvent le voir, et une conversation peut attendre dans la file d’une équipe. Le rôle détermine ce qu’une personne peut faire ; ses équipes déterminent quel travail restreint elle peut atteindre. Les propriétaires et les admins gèrent les équipes dans **Paramètres > Équipes**.

<Frame caption="Paramètres > Équipes — chaque équipe de l’organisation avec son nombre de membres, à côté de l’action Créer une équipe.">

![La page de paramètres Équipes listant trois équipes — Growth, Platform engineering et Customer success — chacune avec un membre et la date de son ajout, à côté d’un bouton Créer une équipe.](/images/platform/settings-teams.webp)

</Frame>

## Créer une équipe

1. Sélectionne **Créer une équipe** et renseigne le champ **Nom de l'équipe**, par exemple `Support client`.
2. Sélectionne les membres de l’organisation à ajouter. Si tu ne sélectionnes personne, Tale t’ajoute à l’équipe.
3. Sélectionne **Créer une équipe**. Vérifie la nouvelle ligne et le nombre de membres dans la liste.

Choisis un nom reconnaissable partout où les équipes apparaissent : dans l’audience d’un document ou d’un projet, comme file dans la boîte de réception, dans un filtre de liste. Le formulaire accepte jusqu’à 80 caractères. Créer une équipe ne lui rattache pas le travail existant : sélectionne-la sur les documents, projets et conversations qu’elle doit couvrir.

## Modifier le nom ou les membres

Ouvre la ligne d’une équipe pour consulter ses membres. Son menu propose **Voir**, **Modifier** et **Supprimer**. Utilise **Modifier** pour changer le nom ou les membres, puis enregistre et vérifie le nombre de membres.

Une équipe conserve au moins un membre. Pour retirer le dernier, supprime plutôt l’équipe.

Une personne peut appartenir à plusieurs équipes. Elle peut conserver un accès grâce à une autre équipe ou à une attribution directe. La retirer d’une équipe ne supprime donc pas forcément tous ses accès à une ressource. Vérifie les autres voies d’accès lorsque tu retires des droits.

Une équipe provisionnée par ton fournisseur d’identité porte la mention **Synchronisée** dans la liste. Son nom et ses membres appartiennent au fournisseur : le dialogue de modification les affiche en lecture seule, car la prochaine synchronisation annulerait une modification locale. Tu peux tout de même supprimer une telle équipe localement ; le fournisseur peut la recréer.

<Tip>

Renomme une équipe existante si son objectif change mais que les mêmes personnes doivent garder leurs accès. La supprimer puis la recréer produit une autre équipe et modifie les attributions des ressources existantes.

</Tip>

## Ce qu’une équipe détermine

Toute ressource liée à des équipes suit la même règle. Une ressource sans équipe est visible par toute l’organisation. Une ressource avec des équipes est visible par les membres de l’une d’elles. Les propriétaires et les admins voient tout dans les deux cas : une équipe ne sert donc jamais à masquer du travail aux administrateurs.

| Ressource | Rôle de l’équipe |
| --- | --- |
| Projets | **Audience**, dans **Général**, liste les équipes qui peuvent ouvrir le projet ; vide signifie toute l’organisation. |
| Documents et dossiers | Un document ou un dossier porte les équipes qui peuvent le lire. Ce qui est rangé dans un dossier d’équipe reprend ses équipes et ne peut pas en nommer une autre. |
| Skills | La visibilité par équipe rend un skill disponible aux équipes choisies. |
| Conversations | L’attribution à une équipe place la conversation dans sa file. |

Lorsque tu restreins un travail à des équipes, tu ne peux choisir que celles dont tu fais partie ; les propriétaires et les admins choisissent n’importe quelle équipe de l’organisation. Appartenir à une équipe n’autorise pas une action interdite par le rôle : un Éditeur et un Membre de la même équipe peuvent avoir des droits de modification différents.

Chaque membre voit ses équipes dans **Paramètres > Compte > Tes équipes** et dans la ligne **Équipes** du menu de profil. Pour restreindre une liste à certains travaux, chaque liste propose un filtre **Équipes** avec **Toute l'organisation**, **Mes équipes** et chaque équipe par son nom ; la boîte de réception utilise plutôt un filtre **Responsable**, qui couvre les personnes comme les équipes. Consulte [Gérer ton compte](/fr/platform/member/preferences#teams).

Pour les conversations entrantes, [les règles de routage](/fr/platform/admin/governance/policies-and-limits#routage-des-conversations) peuvent choisir l’équipe dès l’arrivée. Sans attribution à une personne ou à une équipe, la conversation reste dans le triage des administrateurs.

## Retirer une équipe sans perdre de vue les accès

Sélectionne **Supprimer** dans le menu de la ligne. La confirmation compte les membres de l’équipe, les projets, dossiers et documents dont elle fait partie de l’audience, et les conversations dans sa file. Elle indique aussi combien de ces éléments n’ont pas d’autre équipe et deviendront visibles pour toute l’organisation. Réattribue d’abord le travail dont l’accès doit rester limité.

<Warning>

La suppression d’une équipe est irréversible. Chaque projet, dossier et document perd l’équipe et conserve ses autres équipes. Un élément dont c’était la seule équipe devient visible pour toute l’organisation, ce qui peut élargir son accès.

</Warning>

L’équipe, ses membres, sa présence sur chaque ressource et tout lien avec le fournisseur d’identité disparaissent en une seule opération ; aucune équipe à moitié supprimée ne peut subsister. Une conversation perd son attribution à l’équipe ; si personne ne lui est attribué non plus, elle revient au triage des administrateurs. Les configurations d’import perdent aussi cette association. Les comptes des membres ne sont pas supprimés.

Les équipes synchronisées par [SSO d’entreprise ou SCIM](/fr/platform/admin/enterprise-sso) dépendent aussi des règles du fournisseur d’identité. Vérifie cette source avant de faire une modification locale que tu souhaites conserver.
