---
title: Clés API
description: Crée, vérifie, renouvelle et révoque les identifiants des logiciels qui appellent Tale.
---

Crée une clé API lorsqu’un script ou un service doit appeler l’API REST de Tale. Une clé appartient à la personne qui l’a créée, pas à l’organisation depuis laquelle elle a été créée : elle agit au nom de cette personne, suit ses permissions actuelles et fonctionne dans chaque organisation dont elle est membre. Une requête REST nomme l’organisation visée dans l’en-tête `X-Organization-Slug` ; si le détenteur n’appartient qu’à une seule organisation, l’en-tête peut être omis. Les propriétaires, admins et développeurs gèrent leurs clés dans **Paramètres > API > REST**, tout comme un membre à qui un admin a attribué une compétence qui s’utilise avec une clé : **Appeler les modèles par l'API**, **Exporter les notifications** ou **Agir pour un autre membre**. Tale refuse une nouvelle clé à toute autre personne avec `403 API_KEY_CREATE_FORBIDDEN`.

<Frame caption="Paramètres > API > REST — là où les clés sont créées, renouvelées et révoquées.">

![La boîte de création d’une clé API permet de choisir un nom et une durée de validité avant sa génération.](/images/get-started/settings-api-keys.webp)

</Frame>

## Créer une clé

1. Sélectionne **Créer une clé API**.
2. Saisis un **Nom de la clé** qui identifie le logiciel, par exemple `Synchronisation facturation` ou `Import de documents`.
3. Choisis l’**Expiration** : 7, 30 ou 90 jours, un an, une **Date personnalisée**, ou jamais. La valeur initiale est 30 jours, et le formulaire indique sous le champ le jour où la clé expirera. Avec **Date personnalisée**, choisis ce jour dans le calendrier **Date d'expiration**, entre demain et un an plus tard.
4. Crée la clé et copie sa valeur secrète dans le gestionnaire de secrets prévu pour le logiciel avant de fermer la confirmation.

La valeur complète n’apparaît qu’une fois. Le tableau affiche ensuite un fragment masqué, la date d’expiration, la date de création et la dernière utilisation. Il présente tes clés, pas celles de tes collègues.

<Warning>

Toute personne qui possède une clé peut agir avec les permissions de son propriétaire. Ne la place pas dans le code source, les chats, les captures d’écran ou les journaux. Utilise un compte dont les accès correspondent aux besoins de l’intégration.

</Warning>

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

Une ancienne date de **Dernière utilisation** ne suffit pas à justifier une révocation. Une tâche mensuelle ou une procédure de récupération peut rester longtemps inactive. Vérifie d’abord le logiciel indiqué par le nom de la clé.

## Comprendre les permissions et les limites

Un changement de rôle s’applique aux requêtes suivantes des clés existantes. Désactiver l’adhésion de leur propriétaire retire ses accès ; la clé ne conserve pas le rôle qu’elle avait à sa création. Perdre le rôle ou la compétence qui te permettait de créer des clés laisse en place celles que tu détiens : **Paramètres > API > REST** continue de les lister pour que tu les révoques, mais n’en propose plus de nouvelle.

Donne à une intégration uniquement les accès dont elle a besoin. Un service qui synchronise les notifications n’a par exemple pas besoin d’un compte Admin : un Admin peut accorder à un membre ordinaire la capacité `tale:notifications.export`. Elle permet cet export sans aucun autre droit du rôle Admin, ne vaut que dans l’organisation, peut expirer et prend fin quand le membre est retiré. Attribue-la dans [Compétences](/fr/platform/admin/governance/competences), où une intégration qui relaie les réponses et les décisions de relecture de personnes reçoit de la même façon `tale:rest.act-as` ; [Déléguer l’export sans rôle Admin](/fr/develop/api-reference#deleguer-lexport-sans-role-admin) décrit le côté API.

Les limites de débit REST s’appliquent au propriétaire authentifié de la clé. Plusieurs clés d’une même personne ne donnent pas de quotas de débit distincts. Consulte [les limites de débit](/fr/develop/rate-limits). Une [règle de budget](/fr/platform/admin/governance/policies-and-limits) peut aussi plafonner ce que les requêtes authentifiées par une clé précise peuvent dépenser : leur usage est imputé à la clé, et un envoi ou un appel de modèle au-delà du plafond est refusé avec `429 BUDGET_EXCEEDED`. Les exécutions d’automatisation lancées avec la clé comptent aussi pour elle, en plus des limites personnelles du membre pour lequel la clé agit. [Comment l’usage est compté](/fr/platform/admin/governance/usage-attribution) décrit la règle complète.

Une clé peut aussi appeler les modèles de l’organisation depuis des outils comme opencode ou Claude Code, par les [endpoints de modèles](/fr/develop/use-tale-from-your-editor#model-endpoints), dès qu’un admin les a activés dans [Modèles](/fr/platform/admin/governance/content-models#model-endpoints). La personne qui la détient doit être propriétaire, admin ou développeur, ou détenir **Appeler les modèles par l'API**. Ces appels comptent pour les règles de budget de la clé comme ses messages de chat, et ils apparaissent comme **Appel API direct** dans l’analyse de l’usage, au nom de la personne et de la clé.

Les clés API authentifient les logiciels qui appellent Tale. Les [identifiants des connectors](/fr/platform/admin/connectors) servent dans l’autre sens : ils permettent à Tale d’appeler un service externe. [Utiliser Tale depuis ton éditeur ou un script](/fr/develop/use-tale-from-your-editor) montre où placer une clé dans opencode, Claude Code et un script shell.
