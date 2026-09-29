---
title: Compétences
description: Accorde à un membre un droit bien délimité ou une qualification sans rôle Admin, et révoque-le quand il n’est plus nécessaire.
---

En tant qu’admin ou propriétaire, tiens le registre des compétences de ton organisation dans **Paramètres > Gouvernance > Compétences**. Une compétence est l’une de ces deux choses :

- Une **capacité de la plateforme** permet à un membre une seule action bien délimitée qui demanderait sinon le rôle Admin. Attribue-la au compte qui se trouve derrière une intégration plutôt que d’en faire un admin, ce qui lui permettrait aussi de gérer les membres, l’authentification unique et les mots de passe.
- Une **qualification** est un nom que la politique de relecture de ton organisation peut exiger de la personne qui approuve une relecture.

Une attribution ne s’applique que dans cette organisation. Tale enregistre chaque attribution et chaque révocation dans le journal d’audit, et retirer un membre de l’organisation révoque ses attributions.

## Capacités de la plateforme

| Capacité                                                     | Ce qu’elle permet                                                                                                                                                                                                    |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Exporter les notifications** (`tale:notifications.export`) | Lire par l’API REST les notifications qu’un autre membre peut voir, pour qu’une autre application les reflète.                                                                                                       |
| **Agir pour un autre membre** (`tale:rest.act-as`)           | Nommer, dans un appel d’API, le membre pour qui une question reçoit une réponse ou une relecture est décidée. La chronologie de la tâche et le journal d’audit indiquent alors cette personne plutôt que la clé API. |
| **Publier des skills pour l'organisation** (`tale:skills.publish`) | Partager un skill avec toute l’organisation, même quand la [politique de partage des skills](/fr/platform/admin/governance/policies-and-limits#skill-sharing) le réserve aux éditeurs ou aux admins. |

Les propriétaires et les admins ont les trois par leur rôle. Tout autre membre, par exemple un compte Developer dont une intégration utilise la clé API, a besoin de l’attribution ici. Sans elle, l’API REST répond à un export ou à un `actor` par `403 ROLE_FORBIDDEN`. La [référence de l’API](/fr/develop/api-reference#nommer-le-membre-pour-lequel-on-agit) décrit les deux requêtes.

**Publier des skills pour l'organisation** ne compte que tant que la politique de partage des skills réserve les skills partagés avec l’organisation. Avec **Éditeurs et au-delà**, les éditeurs et les développeurs l’ont déjà par leur rôle. Sans elle, un membre ne peut partager des skills qu’avec ses propres équipes ; l’éditeur de skills, les téléversements et l’API REST refusent un skill partagé avec l’organisation par `403 SKILL_PUBLISH_FORBIDDEN`.

## Attribuer une compétence

1. Choisis **Attribuer une compétence**.
2. Choisis le **Membre**.
3. Choisis la **Compétence** : une capacité de la plateforme, ou **Qualification**, puis saisis dans **Nom de la qualification** le nom utilisé par ta politique de relecture. Les noms qui commencent par `tale:` sont réservés aux capacités de la plateforme.
4. Choisis quand elle **Expire** : **Jamais**, **Dans 30 jours**, **Dans 90 jours** ou **Dans 1 an**.
5. Si tu le souhaites, note le **Justificatif** : pourquoi ce membre la détient, par exemple un certificat, un ticket ou le système qu’elle sert. Il reste dans le registre.
6. Choisis **Attribuer**.

L’attribution s’applique à la requête suivante du membre ; une intégration n’a pas besoin de redémarrer. Un membre détient chaque compétence une seule fois à la fois : pour en changer l’expiration ou le justificatif, révoque l’attribution et attribue-la à nouveau. Si le membre la détient déjà, la boîte de dialogue le signale et n’attribue rien.

## Révoquer une compétence

Choisis **Révoquer** sur la ligne et confirme avec **Révoquer**. Le membre perd la compétence immédiatement. L’attribution reste dans le registre comme historique, avec le statut **Révoquée** et la date de révocation ; survole la date pour voir qui l’a révoquée.

## Lire le registre

La liste s’ouvre sur les attributions **Active**. Utilise **Filtre > Statut** pour ajouter les attributions **Expirée** et **Révoquée**, ou choisis **Tout effacer** pour toutes les voir.

| Statut       | Signification                                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Active**   | Le membre détient la compétence. La ligne en dessous indique sa date d’expiration, ou **Sans expiration**.                                                   |
| **Expirée**  | La date d’expiration, affichée sous le statut, est passée. Attribue-la à nouveau si le membre en a encore besoin.                                            |
| **Révoquée** | Un admin ou un propriétaire l’a révoquée, ou une nouvelle attribution l’a remplacée après son expiration. La date de révocation est affichée sous le statut. |

Retirer un membre révoque chaque attribution active qu’il détient — capacités comme qualifications –, de sorte qu’un membre réintégré repart sans elles. Une attribution révoquée dont le titulaire a quitté l’organisation l’indique comme **Ancien membre**. Le registre liste toutes les attributions actives et expirées, et comme historique les 1 000 dernières révoquées.

<Tip>

Une intégration peut vérifier sa propre clé avec `GET /api/v1/me` : `capabilities.actAs`, `capabilities.notificationExport` et `capabilities.skillPublish` indiquent si la clé peut utiliser chaque capacité, par son rôle ou par une attribution.

</Tip>
