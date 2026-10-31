---
title: Droits et qualifications
description: Accorde à un membre ou à une équipe un droit bien délimité, ou à un membre une qualification, sans rôle Admin, et révoque-le quand il n’est plus nécessaire.
---

En tant qu’admin ou propriétaire, tiens le registre des droits et qualifications de ton organisation dans **Paramètres > Gouvernance > Droits et qualifications**. Une attribution donne à un membre l’une de ces deux choses :

- Un **droit** permet à un membre une seule action bien délimitée qui demanderait sinon un rôle plus élevé. Attribue-le au compte qui se trouve derrière une intégration plutôt que d’en faire un admin, ce qui lui permettrait aussi de gérer les membres, l’authentification unique et les mots de passe.
- Une **qualification** est un nom que la politique de relecture de ton organisation peut exiger de la personne qui approuve une relecture.

Tu attribues un droit ou une qualification à un membre, ou un droit à une [équipe](#grant-a-right-to-a-team). Une attribution ne s’applique que dans cette organisation. Tale enregistre chaque attribution, chaque modification et chaque révocation dans le journal d’audit, et retirer un membre de l’organisation révoque ses attributions.

## Droits

| Droit                                                        | Ce qu’il permet                                                                                                                                                                                                      |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Exporter les notifications** (`tale:notifications.export`) | Lire par l’API REST les notifications qu’un autre membre peut voir, pour qu’une autre application les reflète.                                                                                                       |
| **Agir pour un autre membre** (`tale:rest.act-as`)           | Nommer, dans un appel d’API, le membre pour qui une question reçoit une réponse ou une relecture est décidée. La chronologie de la tâche et le journal d’audit indiquent alors cette personne plutôt que la clé API. |
| **Publier des skills pour l'organisation** (`tale:skills.publish`) | Partager un skill avec toute l’organisation, même quand la [politique de partage des skills](/fr/platform/admin/governance/policies-and-limits#skill-sharing) le réserve aux éditeurs ou aux admins. |
| **Appeler les modèles par l'API** (`tale:models.api`) | Appeler les modèles de l’organisation depuis ses propres outils avec une clé API personnelle, par les [endpoints de modèles](/fr/develop/use-tale-from-your-editor#model-endpoints), une fois que l’organisation les a activés. Ouvre aussi **Paramètres > API** avec ses onglets **REST** et **Modèles**, pour créer la clé et consulter la configuration. |

Les propriétaires et les admins ont les quatre par leur rôle ; les développeurs ont aussi **Appeler les modèles par l'API** par le leur. Tout autre membre a besoin de l’attribution ici, par exemple un compte Développeur dont une intégration utilise la clé API pour un export. Sans elle, l’API REST répond à un export ou à un `actor` par `403 ROLE_FORBIDDEN`, et les endpoints de modèles répondent `403 MODEL_API_FORBIDDEN`. La [référence de l’API](/fr/develop/api-reference#nommer-le-membre-pour-lequel-on-agit) décrit les requêtes d’export et d’`actor`.

**Exporter les notifications**, **Agir pour un autre membre** et **Appeler les modèles par l'API** s’utilisent avec une clé API personnelle ; chacun permet donc aussi à qui le détient d’en créer une dans **Paramètres > API > REST**. La clé agit avec le rôle de son détenteur, plus ce seul droit.

**Publier des skills pour l'organisation** ne compte que tant que la politique de partage des skills réserve les skills partagés avec l’organisation. Avec **Éditeurs et au-delà**, les éditeurs et les développeurs l’ont déjà par leur rôle. Sans lui, un membre ne peut partager des skills qu’avec ses propres équipes ; l’éditeur de skills, les téléversements et l’API REST refusent un skill partagé avec l’organisation par `403 SKILL_PUBLISH_FORBIDDEN`.

**Appeler les modèles par l'API** ne prend effet que lorsque l’organisation a activé les endpoints de modèles dans [Modèles](/fr/platform/admin/governance/content-models#model-endpoints). Tant qu’ils sont désactivés, la boîte de dialogue le signale quand tu choisis ce droit et y renvoie avec **Ouvrir l'accès aux modèles** ; tu peux quand même l’attribuer. Un membre qui le détient ouvre **Paramètres > API** avec les onglets **REST** et **Modèles**, pour créer une clé personnelle et copier la configuration ; les onglets **MCP** et **WebDAV** restent réservés aux propriétaires, admins et développeurs. Une fois l’attribution révoquée, Tale refuse l’appel de modèle suivant du membre.

## Attribuer un droit ou une qualification

1. Choisis **Attribuer un droit ou une qualification**.
2. Sous **Attribuer à**, choisis **Un membre** puis le **Membre**, ou **Une équipe** puis l’**Équipe**.
3. Dans **Droit ou qualification**, choisis un droit, ou **Qualification**, puis saisis dans **Nom de la qualification** le nom utilisé par ta politique de relecture. Les noms qui commencent par `tale:` sont réservés aux droits. Une équipe ne peut détenir que des droits.
4. Choisis quand l’attribution **Expire** : **Jamais**, **Dans 30 jours**, **Dans 90 jours** ou **Dans 1 an**.
5. Si tu le souhaites, note le **Justificatif** : pourquoi ce membre reçoit l’attribution, par exemple un certificat, un ticket ou le système qu’elle sert. Il reste dans le registre.
6. Choisis **Attribuer**.

L’attribution s’applique à la requête suivante du membre ; une intégration n’a pas besoin de redémarrer. Un membre ou une équipe détient chaque droit et chaque qualification une seule fois à la fois. Si l’attribution existe déjà, la boîte de dialogue le signale et n’attribue rien ; [modifie plutôt l’attribution](#change-a-grant).

## Attribuer un droit à une équipe {#grant-a-right-to-a-team}

Un droit attribué à une équipe est détenu par les membres de l’équipe tant qu’ils en font partie ; tu n’as pas à l’attribuer à chacun :

- Une personne qu’un propriétaire ou un admin ajoute à l’équipe dans [**Paramètres > Équipes**](/fr/platform/admin/teams) le détient dès sa requête suivante, sans autre attribution.
- Une personne qui quitte l’équipe, ou qui est retirée de l’organisation, ne le détient plus par l’équipe.
- Révoquer l’attribution de l’équipe y met fin pour tous ses membres. Supprimer l’équipe révoque ses attributions.

Un membre qui détient aussi le droit par une attribution à son nom, ou par son rôle, le garde.

Seule une adhésion qu’un propriétaire ou un admin a créée dans **Paramètres > Équipes** apporte les attributions de l’équipe. Une adhésion que ton fournisseur d’identité crée par la [synchronisation des groupes SSO ou par SCIM](/fr/platform/admin/enterprise-sso) n’en apporte aucune : le fournisseur ne confère ainsi jamais de droit. Une équipe gérée par le fournisseur affiche **Synchronisée depuis ton fournisseur d'identité** dans la boîte de dialogue et ne peut pas être choisie ; attribue alors le droit à chaque membre, ou à une équipe gérée par un admin.

Une équipe ne détient que des droits. Attribue une qualification à chaque membre qui en a besoin, car une politique de relecture l’exige de la personne qui approuve.

Tu peux aussi attribuer un droit depuis **Paramètres > Membres** : ouvre le menu de la ligne du membre, choisis **Droits** et active l’interrupteur du droit. La même boîte de dialogue s’ouvre avec le membre et le droit déjà choisis, et l’attribution rejoint ce registre. [Consulter les droits d’un membre](/fr/platform/admin/members-and-roles#member-rights) explique ce que montrent les interrupteurs et leurs raisons.

## Modifier une attribution {#change-a-grant}

Choisis le bouton crayon sur la ligne d’une attribution active, nommé **Modifier** avec le droit ou la qualification et le membre ou l’équipe, pour changer quand l’attribution expire ou son justificatif. L’attribution d’une équipe se modifie de la même façon.

1. Choisis quand elle **Expire** : garde la date actuelle avec **Inchangée**, ou choisis **Jamais**, **Dans 30 jours**, **Dans 90 jours** ou **Dans 1 an**, à compter de l’enregistrement.
2. Modifie le **Justificatif**, ou efface-le.
3. Choisis **Enregistrer**.

La modification s’applique à la requête suivante. Le journal d’audit consigne chaque modification avec l’ancienne et la nouvelle date d’expiration et indique si le justificatif a changé ; le justificatif lui-même reste dans le registre. Une attribution expirée ou révoquée ne peut pas être modifiée : crée plutôt une nouvelle attribution.

## Révoquer une attribution

Choisis **Révoquer** sur la ligne et confirme avec **Révoquer**. Le membre perd immédiatement le droit ou la qualification ; pour une attribution à une équipe, ses membres perdent aussi le droit, sauf s’ils le détiennent par une attribution à leur nom. L’attribution reste dans le registre comme historique, avec le statut **Révoquée** et la date de révocation ; survole la date pour voir qui l’a révoquée, ou pourquoi.

Dans **Paramètres > Membres**, tu révoques l’attribution d’un droit de la même façon : choisis **Droits** dans le menu de la ligne du membre, désactive l’interrupteur du droit et confirme avec **Révoquer**.

## Lire le registre {#read-the-register}

La liste s’ouvre sur les attributions **Active**. Utilise **Filtre > Statut** pour ajouter les attributions **Expirée** et **Révoquée**, ou choisis **Tout effacer** pour toutes les voir.

| Statut       | Signification                                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Active**   | Le membre détient le droit ou la qualification. La ligne en dessous indique sa date d’expiration, ou **Sans expiration**.                                    |
| **Expirée**  | La date d’expiration, affichée sous le statut, est passée. Refais l’attribution si le membre en a encore besoin.                                             |
| **Révoquée** | Un admin ou un propriétaire l’a révoquée, une nouvelle attribution l’a remplacée après son expiration, son membre a quitté l’organisation, ou son équipe a été supprimée. La date de révocation est affichée sous le statut. |

Une attribution à une équipe indique l’équipe, avec la mention **Équipe** ; une fois l’équipe supprimée, elle indique **Équipe supprimée**. Chaque attribution à une équipe, chaque modification et chaque révocation est enregistrée dans le [journal d’audit](/fr/platform/admin/governance/audit-logs) avec l’identifiant et le nom de l’équipe.

Retirer un membre révoque chaque attribution active qu’il détient — droits comme qualifications —, de sorte qu’un membre réintégré repart sans elles. Une attribution révoquée dont le titulaire a quitté l’organisation l’indique comme **Ancien membre**. Le registre liste toutes les attributions actives et expirées, et comme historique les 1 000 dernières révoquées.

<Tip>

Une intégration peut vérifier sa propre clé avec `GET /api/v1/me` : `capabilities.actAs`, `capabilities.notificationExport`, `capabilities.skillPublish` et `capabilities.modelApi` indiquent si la clé peut utiliser chaque droit, par son rôle ou par une attribution ; `capabilities.modelApi` exige en plus que les endpoints de modèles soient activés.

</Tip>
