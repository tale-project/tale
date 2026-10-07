---
title: Clés API
description: Crée, vérifie, renouvelle et révoque les identifiants des logiciels qui appellent Tale.
---

Crée une clé API lorsqu’un script ou un service doit appeler l’API REST de Tale. Une clé que tu crées pour toi t’appartient, pas à l’organisation depuis laquelle elle a été créée : elle agit en ton nom, suit tes permissions actuelles et fonctionne dans chaque organisation dont tu es membre. Une requête REST nomme l’organisation visée dans l’en-tête `X-Organization-Slug` ; si le détenteur n’appartient qu’à une seule organisation, l’en-tête peut être omis. Les propriétaires, admins et développeurs gèrent leurs clés dans **Paramètres > API > REST**, tout comme un membre à qui un admin a attribué une compétence qui s’utilise avec une clé : **Appeler les modèles par l'API**, **Exporter les notifications** ou **Agir pour un autre membre**. Tale refuse une nouvelle clé à toute autre personne avec `403 API_KEY_CREATE_FORBIDDEN`.

Les propriétaires et admins peuvent aussi créer une clé pour un autre membre, une équipe, un projet ou l’organisation elle-même. Une telle clé ne fonctionne que dans cette organisation ; [Créer une clé pour quelqu’un d’autre](#create-a-key-for-someone-else) explique au nom de qui elle agit et ce qu’elle atteint. Un membre pour qui un admin a créé une clé la trouve lui aussi dans **Paramètres > API > REST**.

<Frame caption="Paramètres > API > REST — là où les clés sont créées, renouvelées et révoquées.">

![La boîte de création d’une clé API permet de choisir un nom, à qui appartient la clé et une durée de validité avant sa génération.](/images/get-started/settings-api-keys.webp)

</Frame>

## Créer une clé

1. Sélectionne **Créer une clé API**.
2. Saisis un **Nom de la clé** qui identifie le logiciel, par exemple `Synchronisation facturation` ou `Import de documents`.
3. En tant que propriétaire ou admin, choisis dans **Appartient à** pour qui est la clé. **Toi** est présélectionné ; les autres choix sont décrits [plus bas](#create-a-key-for-someone-else).
4. Choisis l’**Expiration** : 7, 30 ou 90 jours, un an, une **Date personnalisée**, ou jamais. La valeur initiale est 30 jours, et le formulaire indique sous le champ le jour où la clé expirera. Avec **Date personnalisée**, choisis ce jour dans le calendrier **Date d'expiration**, entre demain et un an plus tard.
5. Crée la clé et copie sa valeur secrète dans le gestionnaire de secrets prévu pour le logiciel avant de fermer la confirmation.

La valeur complète n’apparaît qu’une fois. Le tableau affiche ensuite un fragment masqué, à qui appartient la clé, la date d’expiration, la date de création et la dernière utilisation. Il présente tes propres clés et celles qu’un admin a créées pour toi dans cette organisation ; les propriétaires et admins voient en plus toutes les clés créées ici pour un membre, une équipe, un projet ou l’organisation, jamais les clés que les membres ont créées pour eux-mêmes. Sous **Appartient à**, la clé d’une équipe, d’un projet ou de l’organisation indique le rôle avec lequel elle agit, et une clé créée pour un membre indique qui l’a créée.

<Warning>

Toute personne qui possède une clé peut agir avec les permissions de son propriétaire. Ne la place pas dans le code source, les chats, les captures d’écran ou les journaux. Utilise un compte dont les accès correspondent aux besoins de l’intégration.

</Warning>

## Créer une clé pour quelqu’un d’autre {#create-a-key-for-someone-else}

Les propriétaires et admins choisissent dans **Appartient à** pour qui est une nouvelle clé :

- **Un autre membre** : la clé agit au nom de ce membre, avec son rôle et ses équipes actuels, dans cette organisation uniquement, et son usage compte pour les limites de ce membre. Tu peux choisir un membre dont le rôle est inférieur au tien. La clé ne fonctionne que tant que tu restes propriétaire ou admin au-dessus de ce membre : elle s’arrête si tu pars, perds ce rôle ou si le membre atteint ton rôle. Ce membre reçoit une notification, voit la clé dans sa liste et peut la révoquer. Transmets-lui la valeur secrète par un canal sûr.
- **Une équipe**, **Un projet** ou **L'organisation** : la clé appartient à cette équipe, à ce projet ou à l’organisation plutôt qu’à une personne, et continue de fonctionner après ton départ. Elle agit avec le rôle que tu choisis dans **Agit en tant que** : Membre, Éditeur ou Développeur, et Admin pour la clé de l’organisation uniquement. Ce rôle ne peut pas dépasser le tien.

<Frame caption="Une clé de l’organisation elle-même agit avec le rôle choisi dans Agit en tant que.">

![La boîte de création d’une clé API pour une clé qui appartient à l’organisation elle-même, agit en tant que développeur et expire dans 30 jours.](/images/platform/settings-api-keys-organization.webp)

</Frame>

| La clé | Atteint |
| --- | --- |
| d’une équipe | Ce qu’atteint un membre de cette équipe avec le rôle choisi : les projets, les documents et la boîte de réception de l’équipe, ainsi que tout ce que l’organisation partage avec tous ses membres |
| d’un projet | Ce projet seulement : les routes sous `/api/v1/projects/{projectId}`, `GET /api/v1/projects`, qui ne liste que ce projet, `GET /api/v1/me` et les endpoints de modèles. Toute autre route répond `403 API_KEY_SCOPE_FORBIDDEN`. Par l’assistant de chat, elle lit les fichiers et les tâches de son projet, mais aucun contact, produit, site web ni la boîte de réception de l’organisation |
| de l’organisation | Ce qu’atteint un membre avec le rôle choisi dans toute l’organisation |

Ces clés n’ont pas besoin de `X-Organization-Slug` ; un en-tête qui nomme une autre organisation reçoit `403 ORG_FORBIDDEN`. Une clé prend fin avec ce à quoi elle appartient : si son membre quitte l’organisation ou si son équipe ou son projet est supprimé, elle est révoquée et le journal d’audit en consigne la raison ; si l’organisation est supprimée, ses clés sont supprimées avec elle.

## Vérifier l’appel

Suis la requête authentifiée du [démarrage rapide de l’API](/fr/get-started/developers). Vérifie l’identité et l’organisation renvoyées avant de lancer une écriture ou un import. Consulte ensuite **Dernière utilisation** dans le tableau des clés.

Une authentification réussie n’autorise pas l’accès à toutes les ressources. Les droits sur les projets et le rôle actuel du propriétaire de la clé restent applicables. En cas d’échec, lis l’erreur de l’API pour distinguer une clé expirée ou révoquée d’une permission manquante sur une ressource.

## Renouveler une clé sans interruption

1. Crée une clé de remplacement avant l’expiration de l’ancienne. La colonne **Expiration** indique quand elle arrive.
2. Mets à jour le gestionnaire de secrets du logiciel, puis redémarre-le ou recharge sa configuration si nécessaire.
3. Vérifie une requête authentifiée avec la nouvelle clé.
4. Révoque l’ancienne seulement après avoir migré tous les logiciels qui en dépendent.

Tale ne renouvelle pas les clés automatiquement. La création et la révocation passent par cette interface, pas par `/api/v1`. Un logiciel peut consulter le nom et l’expiration de sa clé avec `GET /api/v1/me` et prévenir la personne responsable avant son échéance.

## Révoquer une clé

Dans le menu de sa ligne, sélectionne **Révoquer la clé**, puis confirme. Les requêtes suivantes ne peuvent plus s’authentifier avec cette clé, appels aux endpoints de modèles compris ; une réponse déjà en cours de flux se termine. La révocation est irréversible ; crée une nouvelle clé si tu as révoqué la mauvaise. La création et la révocation d’une clé laissent chacune une entrée dans le journal d’audit, sous **Paramètres > Gouvernance > Journaux**, dans chaque organisation dont tu fais partie.

Les propriétaires et admins peuvent révoquer toute clé créée ici pour un membre, une équipe, un projet ou l’organisation, et un membre les clés qu’un admin a créées pour lui. Les clés personnelles d’un membre ne sont révocables que par lui ; pour les couper dans cette organisation, désactive ou retire le membre. Une telle clé se gère uniquement dans son organisation : sa création et sa révocation y sont consignées, avec la personne qui l’a créée ou révoquée.

Une ancienne date de **Dernière utilisation** ne suffit pas à justifier une révocation. Une tâche mensuelle ou une procédure de récupération peut rester longtemps inactive. Vérifie d’abord le logiciel indiqué par le nom de la clé.

## Comprendre les permissions et les limites

Un changement de rôle s’applique aux requêtes suivantes des clés existantes. Désactiver l’adhésion de leur propriétaire retire ses accès ; la clé ne conserve pas le rôle qu’elle avait à sa création. Perdre le rôle ou la compétence qui te permettait de créer des clés laisse en place celles que tu détiens : **Paramètres > API > REST** continue de les lister pour que tu les révoques, mais n’en propose plus de nouvelle.

Donne à une intégration uniquement les accès dont elle a besoin. Un service qui synchronise les notifications n’a par exemple pas besoin d’un compte Admin : un Admin peut accorder à un membre ordinaire la capacité `tale:notifications.export`. Elle permet cet export sans aucun autre droit du rôle Admin, ne vaut que dans l’organisation, peut expirer et prend fin quand le membre est retiré. Attribue-la dans [Compétences](/fr/platform/admin/governance/competences), où une intégration qui relaie les réponses et les décisions de relecture de personnes reçoit de la même façon `tale:rest.act-as` ; [Déléguer l’export sans rôle Admin](/fr/develop/api-reference#deleguer-lexport-sans-role-admin) décrit le côté API.

Les limites de débit REST s’appliquent au propriétaire authentifié de la clé. Plusieurs clés d’une même personne ne donnent pas de quotas de débit distincts, tandis qu’une clé qu’un propriétaire ou un admin a créée pour un membre, une équipe, un projet ou l’organisation a son propre quota. Consulte [les limites de débit](/fr/develop/rate-limits). Une [règle de budget](/fr/platform/admin/governance/policies-and-limits) peut aussi plafonner ce que les requêtes authentifiées par une clé précise peuvent dépenser : leur usage est imputé à la clé, et un envoi ou un appel de modèle au-delà du plafond est refusé avec `429 BUDGET_EXCEEDED`. Les exécutions d’automatisation lancées avec la clé comptent aussi pour elle, en plus des limites personnelles du membre pour lequel la clé agit. Une clé créée pour un membre compte pour les limites de ce membre, comme sa propre clé. La clé d’une équipe, d’un projet ou de l’organisation dépense en son propre nom : aucune limite personnelle, de rôle ou par défaut ne s’applique à elle, mais les limites de l’organisation et toute règle visant la clé s’appliquent, et la clé d’une équipe compte aussi pour la limite de son équipe, qui la plafonne. L’analyse de l’usage présente une telle clé sur sa propre ligne, jamais comme utilisateur actif. [Comment l’usage est compté](/fr/platform/admin/governance/usage-attribution) décrit la règle complète.

Une clé peut aussi appeler les modèles de l’organisation depuis des outils comme opencode ou Claude Code, par les [endpoints de modèles](/fr/develop/use-tale-from-your-editor#model-endpoints), dès qu’un admin les a activés dans [Modèles](/fr/platform/admin/governance/content-models#model-endpoints). La personne qui la détient doit être propriétaire, admin ou développeur, ou détenir **Appeler les modèles par l'API**. Ces appels comptent pour les règles de budget de la clé comme ses messages de chat, et ils apparaissent comme **Appel API direct** dans l’analyse de l’usage, au nom de la personne et de la clé.

Les clés API authentifient les logiciels qui appellent Tale. Les [identifiants des connecteurs](/fr/platform/admin/connectors) servent dans l’autre sens : ils permettent à Tale d’appeler un service externe. [Utiliser Tale depuis ton éditeur ou un script](/fr/develop/use-tale-from-your-editor) montre où placer une clé dans opencode, Claude Code et un script shell.
