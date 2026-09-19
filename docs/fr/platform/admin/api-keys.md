---
title: Clés API
description: Crée, vérifie, renouvelle et révoque les identifiants des logiciels qui appellent Tale.
---

Crée une clé API lorsqu’un script ou un service doit appeler l’API REST de Tale. La clé agit au nom de la personne qui l’a créée et suit ses permissions actuelles dans l’organisation. Les propriétaires, admins et développeurs gèrent leurs clés dans **Paramètres > API > REST**.

<Frame caption="Paramètres > API > REST — là où les clés sont créées, renouvelées et révoquées.">

![La boîte de création d’une clé API permet de choisir un nom et une durée de validité avant sa génération.](/images/get-started/settings-api-keys.webp)

</Frame>

## Créer une clé

1. Sélectionne **Créer une clé API**.
2. Saisis un **Nom de la clé** qui identifie le logiciel, par exemple `Synchronisation facturation` ou `Import de documents`.
3. Choisis l’**Expiration** : 7, 30 ou 90 jours, un an, ou jamais. La valeur initiale est 30 jours.
4. Crée la clé et copie sa valeur secrète dans le gestionnaire de secrets prévu pour le logiciel avant de fermer la confirmation.

La valeur complète n’apparaît qu’une fois. Le tableau affiche ensuite un fragment masqué, la date de création et la dernière utilisation. Il présente tes clés, pas celles de tes collègues.

<Warning>

Toute personne qui possède une clé peut agir avec les permissions de son propriétaire. Ne la place pas dans le code source, les chats, les captures d’écran ou les journaux. Utilise un compte dont les accès correspondent aux besoins de l’intégration.

</Warning>

## Vérifier l’appel

Suis la requête authentifiée du [démarrage rapide de l’API](/fr/get-started/developers). Vérifie l’identité et l’organisation renvoyées avant de lancer une écriture ou un import. Consulte ensuite **Dernière utilisation** dans le tableau des clés.

Une authentification réussie n’autorise pas l’accès à toutes les ressources. Les droits sur les projets et le rôle actuel du propriétaire de la clé restent applicables. En cas d’échec, lis l’erreur de l’API pour distinguer une clé expirée ou révoquée d’une permission manquante sur une ressource.

## Renouveler une clé sans interruption

1. Crée une clé de remplacement avant l’expiration de l’ancienne.
2. Mets à jour le gestionnaire de secrets du logiciel, puis redémarre-le ou recharge sa configuration si nécessaire.
3. Vérifie une requête authentifiée avec la nouvelle clé.
4. Révoque l’ancienne seulement après avoir migré tous les logiciels qui en dépendent.

Tale ne renouvelle pas les clés automatiquement. La création et la révocation passent par cette interface, pas par `/api/v1`. Un logiciel peut consulter le nom et l’expiration de sa clé avec `GET /api/v1/me` et prévenir la personne responsable avant son échéance.

## Révoquer une clé

Dans le menu de sa ligne, sélectionne **Révoquer la clé**, puis confirme. Les requêtes suivantes ne peuvent plus s’authentifier avec cette clé. La révocation est irréversible ; crée une nouvelle clé si tu as révoqué la mauvaise.

Une ancienne date de **Dernière utilisation** ne suffit pas à justifier une révocation. Une tâche mensuelle ou une procédure de récupération peut rester longtemps inactive. Vérifie d’abord le logiciel indiqué par le nom de la clé.

## Comprendre les permissions et les limites

Un changement de rôle s’applique aux requêtes suivantes des clés existantes. Désactiver l’adhésion de leur propriétaire retire ses accès ; la clé ne conserve pas le rôle qu’elle avait à sa création.

Donne à une intégration uniquement les accès dont elle a besoin. Un service qui synchronise les notifications n’a par exemple pas besoin d’un compte Admin : un Admin peut accorder à un membre ordinaire la capacité `tale:notifications.export`. Elle permet cet export sans aucun autre droit du rôle Admin, ne vaut que dans l’organisation, peut expirer et prend fin quand le membre est retiré. Voir [Déléguer l’export sans rôle Admin](/fr/develop/api-reference#deleguer-lexport-sans-role-admin).

Les limites de débit REST s’appliquent au propriétaire authentifié de la clé. Plusieurs clés d’une même personne ne donnent pas de quotas de débit distincts. Consulte [les limites de débit](/fr/develop/rate-limits). Une [règle de budget](/fr/platform/admin/governance/policies-and-limits) peut aussi plafonner ce que les requêtes authentifiées par une clé précise peuvent dépenser : leur usage est imputé à la clé, et un envoi au-delà du plafond est refusé avec `429 BUDGET_EXCEEDED`. Les exécutions d’automatisation lancées avec la clé comptent aussi pour elle, en plus des limites personnelles du membre pour lequel la clé agit. [Comment l’usage est compté](/fr/platform/admin/governance/usage-attribution) décrit la règle complète.

Les clés API authentifient les logiciels qui appellent Tale. Les [identifiants des connecteurs](/fr/platform/admin/connectors) servent dans l’autre sens : ils permettent à Tale d’appeler un service externe.
