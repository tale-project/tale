---
title: Membres et rôles
description: Ajoute des personnes, choisis leurs permissions et gère les accès aux comptes.
---

Ajoute des personnes dans **Paramètres > Membres**, puis choisis le rôle adapté à leur travail. Le rôle détermine les actions autorisées. Les accès aux projets, les équipes et l’attribution des conversations déterminent les ressources accessibles.

<Video src="/videos/fr/tutorials/ep8-people/ep8-people.fr.mp4" poster="/videos/fr/tutorials/ep8-people/ep8-people.fr.webp" captions="/videos/fr/tutorials/ep8-people/ep8-people.fr.vtt" lang="fr" title="Épisode 8 — Personnes, rôles & équipes" caption="Épisode 8 — Personnes, rôles & équipes (2:06)">

</Video>

<Frame caption="Paramètres > Membres — chaque compte et le rôle qui le borne.">

![La page de paramètres Membres listant le propriétaire de l’espace de travail et quatre autres personnes, chacune avec son badge de rôle, à côté d’un bouton Ajouter un membre.](/images/get-started/settings-organization-members.webp)

</Frame>

## Ajouter une personne

Tu dois avoir le rôle Propriétaire ou Admin pour gérer les membres.

1. Ouvre **Paramètres > Membres** et sélectionne **Ajouter un membre**.
2. Saisis son **Courriel** et, si tu le souhaites, son **Nom**.
3. Choisis un **Rôle**. Membre convient à l’utilisation quotidienne ; le tableau ci-dessous précise quand donner davantage de droits.
4. Pour un nouveau compte Tale, définis un **Mot de passe** qui respecte les exigences affichées. Si l’adresse appartient déjà à un compte, Tale réutilise ses identifiants et masque le champ du mot de passe.
5. Sélectionne **Ajouter un membre**. Pour un nouveau compte, conserve les identifiants affichés dans la confirmation avant de la fermer, puis transmets-les par le canal prévu dans ton organisation.

La personne apparaît dans la liste. Ce parcours n’envoie ni invitation ni courriel de réinitialisation du mot de passe : en ajoutant quelqu’un, tu confirmes son adresse. Le compte fonctionne donc partout tout de suite, y compris dans les applications où l’on se connecte avec son compte Tale. Si l’adresse est déjà membre de cette organisation, le formulaire le signale sans créer de doublon.

Un mot de passe défini ou réinitialisé par un administrateur, ou expiré selon la politique de rotation, doit être changé à la connexion. Consulte [les étapes de changement destinées aux membres](/fr/platform/member/preferences#quand-un-changement-de-mot-de-passe-est-requis).


<Tip>

Ajoute ensuite la personne aux équipes dont elle a besoin. Un rôle seul ne donne pas les accès aux projets d’une équipe ni à sa file de conversations.

</Tip>

## Choisir un rôle

| Rôle | Travail habituel | Administration de l’organisation |
| --- | --- | --- |
| **Propriétaire** | Toutes les tâches du produit et de son administration | Peut aussi transférer la propriété et [supprimer l’organisation](/fr/platform/admin/organization#delete-the-organization), ce qui efface également ses sandboxes et leurs fichiers ; la suppression demande de taper le nom de l’organisation avant d’activer le bouton. |
| **Admin** | Gérer les personnes, les services, les politiques et le travail de l’équipe | Tous les paramètres de l’organisation, sans transfert de propriété. |
| **Développeur** | Créer des agents, des automatisations et des intégrations | Paramètres techniques des fournisseurs, connectors et API ; pas de gestion des membres. |
| **Éditeur** | Entretenir les contenus et traiter le travail quotidien | Modification du contenu ; pas d’accès à **Automatisations** ; lecture seule des ressources de connectors. |
| **Membre** | Utiliser le chat, lire les ressources partagées et créer des tâches de projet, en confiant les siennes aux agents du projet | Pas d’administration ; peut donner un avis sur les messages. |
| **Désactivé** | Aucun accès actif | Conserve l’adhésion sans accorder de permissions. |

Seuls les propriétaires, les admins et les développeurs voient **Automatisations**, dans la navigation comme dans les projets ; pour les autres, un lien vers une automatisation affiche **Accès refusé**.

Les personnes qui ne sont ni propriétaires ni admins ne peuvent pas ouvrir **Paramètres > Membres** ; elles voient leur propre rôle dans [**Paramètres > Compte > Ton rôle**](/fr/platform/member/preferences#role).

Les tâches de projet suivent une règle qui leur est propre : toute personne qui peut ouvrir un projet y crée des tâches et modifie les siennes, celles qu’elle a créées ou qui lui sont attribuées, tandis que les Éditeurs et les rôles supérieurs modifient toutes les tâches. Les paramètres, les agents et les fichiers du projet restent réservés aux Éditeurs. [Gérer les tâches d’un projet](/fr/platform/projects/tasks#qui-peut-creer-et-modifier-les-taches) détaille ce qu’un Membre peut faire de ses propres tâches.

Ce tableau décrit les capacités des rôles, sans garantir l’accès à chaque élément. Les conversations suivent leur attribution : une personne voit le travail qui lui est attribué ou qui appartient à ses équipes. Les conversations non attribuées restent réservées aux propriétaires et aux admins pour le triage. Consulte [le routage des conversations](/fr/platform/admin/governance/policies-and-limits#routage-des-conversations).

Seuls les propriétaires et les admins peuvent lire les journaux d’audit. Les actions des autres rôles peuvent produire des entrées, sans leur donner accès au journal.

## Changer un rôle ou réinitialiser un mot de passe

Dans le menu de la ligne de la personne, sélectionne **Modifier**, puis change le **Rôle**. Sélectionne **Enregistrer** et vérifie le rôle dans la liste. Pour rétablir l’accès d’un membre désactivé, choisis explicitement le rôle à lui attribuer.

Le dialogue permet aussi de changer le nom affiché. Le courriel est en lecture seule. Pour définir un nouveau mot de passe, active **Mettre à jour le mot de passe**, saisis une valeur conforme aux exigences affichées, puis enregistre. Le membre doit choisir un nouveau mot de passe à sa prochaine connexion ; une réinitialisation le déconnecte de toutes ses sessions. Vérifie l’identité de la personne selon la procédure de ton organisation avant de réinitialiser son compte.

Ce menu ne permet pas de modifier ton propre rôle, d’attribuer Propriétaire dans la liste des rôles, ni de rétrograder le dernier administrateur. Les propriétaires existants et le créateur de l’organisation ont aussi des rôles protégés. Si une modification est refusée, vérifie le compte concerné avant d’essayer un autre rôle.

## Consulter les droits d’un membre {#member-rights}

Quatre droits de la plateforme permettent chacun à un membre une action bien délimitée qui demanderait sinon un rôle plus élevé : **Appeler les modèles par l'API**, **Exporter les notifications**, **Agir pour un autre membre** et **Publier des skills pour l'organisation**. Pour voir ce qu’une personne peut faire et pourquoi, ouvre le menu de sa ligne et choisis **Droits**. Seuls les propriétaires et les admins voient cette action, sur chaque ligne, y compris la leur et celle du propriétaire.

La boîte de dialogue liste les quatre droits. Chacun affiche **Autorisé** ou **Non autorisé**, c’est-à-dire la réponse que Tale donne quand la personne utilise ce droit, suivie des raisons qui la fondent :

- **Le réglage de l’organisation.** Pour **Appeler les modèles par l'API**, si les [endpoints de modèles pour les clés API](/fr/platform/admin/governance/content-models#model-endpoints) sont activés. Tant qu’ils sont désactivés, personne n’a ce droit, quels que soient son rôle et ses attributions ; si le réglage est illisible, les endpoints comptent comme désactivés. Pour **Publier des skills pour l'organisation**, le mode de la [politique de partage des skills](/fr/platform/admin/governance/policies-and-limits#skill-sharing) ; si la politique est illisible, c’est **Propriétaires et admins uniquement** qui s’applique.
- **Le rôle.** Il inclut le droit, demande une attribution pour ce droit ou, pour **Désactivé**, exclut tout droit, même attribué.
- **L’attribution.** Qui a attribué le droit et quand, et jusqu’à quand si l’attribution expire, ou quand une attribution expirée a pris fin. Si la personne qui l’a attribué a quitté l’organisation, elle apparaît comme **Ancien membre**.
- **L’attribution à une équipe.** Si le droit est attribué à une [équipe](/fr/platform/admin/governance/rights-and-qualifications#grant-a-right-to-a-team) à laquelle un propriétaire ou un admin a ajouté la personne : l’équipe, qui a attribué le droit et quand, et jusqu’à quand, une ligne par équipe. La personne détient le droit par l’équipe tant qu’elle en fait partie. Une équipe dont elle fait partie par ton fournisseur d’identité ne lui apporte aucune attribution et n’apparaît donc pas.

Si le rôle demande une attribution et que ni la personne ni l’une de ses équipes n’en détient, la raison indique que le droit n’est pas attribué.

L’interrupteur à côté de chaque droit représente l’attribution propre de la personne dans le [registre des droits et qualifications](/fr/platform/admin/governance/rights-and-qualifications), pas la réponse : il est activé tant qu’elle détient elle-même une attribution active. Un interrupteur peut donc être activé alors que le droit affiche **Non autorisé**, par exemple tant que les endpoints de modèles sont désactivés ou si le membre a le rôle **Désactivé**. Un rôle qui inclut le droit, ou une attribution à une équipe, affiche **Autorisé** avec l’interrupteur désactivé. L’attribution à une équipe n’a pas d’interrupteur ici : révoque-la dans [Droits et qualifications](/fr/platform/admin/governance/rights-and-qualifications), ou retire la personne de l’équipe.

- Pour attribuer un droit, active son interrupteur. **Attribuer un droit ou une qualification** s’ouvre avec la personne et le droit déjà choisis : choisis quand l’attribution **Expire**, note si tu le souhaites le **Justificatif**, puis choisis **Attribuer**.
- Pour révoquer l’attribution, désactive l’interrupteur et confirme avec **Révoquer**.

Les deux fonctionnent comme l’attribution et la révocation dans [Droits et qualifications](/fr/platform/admin/governance/rights-and-qualifications), avec les mêmes vérifications, et chaque changement est consigné dans le registre et dans le journal d’audit. La boîte de dialogue relit les droits à chaque ouverture ; s’ils ne peuvent pas être chargés, choisis **Réessayer**.

## Transférer la propriété

Un propriétaire peut sélectionner **Transférer la propriété** dans le menu d’un autre membre. Lis la confirmation : la personne choisie devient Propriétaire et le propriétaire qui effectue le transfert devient Admin. Utilise cette action pour transmettre la responsabilité de l’organisation, pas pour une promotion ordinaire.

## Retirer ou rétablir l’accès

Choisis **Désactivé** pour arrêter l’accès tout en conservant l’adhésion. L’action **Supprimer** de la ligne retire l’adhésion à cette organisation. Elle supprime aussi, avec leurs fichiers, les espaces de travail de sandbox propres aux [exécutions d’agent que la personne a démarrées](/fr/platform/projects/tasks#executions-demarrees-par-un-membre) ; **Désactivé** les conserve. Elle révoque aussi les [clés API](/fr/platform/admin/api-keys#create-a-key-for-someone-else) qu’un propriétaire ou un admin a créées ici pour la personne, et celles que la personne a créées ici pour d’autres membres. Dans les deux cas, les relectures qui attendent la personne passent au [relecteur](/fr/platform/projects/tasks#designer-un-responsable-et-un-relecteur) suivant. Après le retrait, les tâches conservent les commentaires, l’activité et les attributions de la personne, et affichent **Ancien membre** là où figurait son nom. Vérifie d’abord les travaux partagés et les responsabilités dans les équipes. Retirer une adhésion n’est pas une [demande d’effacement des données](/fr/platform/admin/governance/data-subject-requests).

Si un membre perd son authentificateur ou sa passkey, ouvre **Modifier** et utilise les contrôles de sécurité correspondants. [L’authentification à double facteur](/fr/platform/admin/two-factor-authentication) explique la récupération, la réinitialisation et leurs effets sur les sessions.
