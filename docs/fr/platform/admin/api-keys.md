---
title: Clés API
description: Crée, vérifie, renouvelle et révoque les identifiants des logiciels qui appellent Tale.
---

Crée une clé API lorsqu’un script ou un service doit appeler l’API REST de Tale. Une clé que tu crées pour toi t’appartient, pas à l’organisation depuis laquelle elle a été créée : elle agit en ton nom, suit tes permissions actuelles et fonctionne dans chaque organisation dont tu es membre, sauf si un propriétaire ou un admin y a [désactivé les clés personnelles des membres](#members-personal-keys). Une requête REST nomme l’organisation visée dans l’en-tête `X-Organization-Slug` ; si le détenteur n’appartient qu’à une seule organisation, l’en-tête peut être omis. Les propriétaires, admins et développeurs gèrent leurs clés dans **Paramètres > API > REST**, tout comme un membre à qui un admin a attribué un droit qui s’utilise avec une clé : **Appeler les modèles par l'API**, **Exporter les notifications** ou **Agir pour un autre membre**. Tale refuse une nouvelle clé à toute autre personne avec `403 API_KEY_CREATE_FORBIDDEN`.

Les propriétaires et admins peuvent aussi créer une clé pour un autre membre, une équipe, un projet ou l’organisation elle-même. Une telle clé ne fonctionne que dans cette organisation ; [Créer une clé pour quelqu’un d’autre](#create-a-key-for-someone-else) explique au nom de qui elle agit et ce qu’elle atteint. Un membre pour qui un admin a créé une clé la trouve lui aussi dans **Paramètres > API > REST**.

<Frame caption="Paramètres > API > REST — là où les clés sont créées, renouvelées et révoquées.">

![La boîte de création d’une clé API permet de choisir un nom, à qui appartient la clé et une durée de validité avant sa génération.](/images/get-started/settings-api-keys.webp)

</Frame>

## Créer une clé

1. Sélectionne **Créer une clé API**.
2. Saisis un **Nom de la clé** qui identifie le logiciel, par exemple `Synchronisation facturation` ou `Import de documents`.
3. En tant que propriétaire ou admin, choisis dans **Appartient à** pour qui est la clé. **Toi** est présélectionné ; les autres choix sont décrits [plus bas](#create-a-key-for-someone-else).
4. Choisis l’**Expiration** : 7, 30 ou 90 jours, un an, une **Date personnalisée**, ou jamais. La valeur initiale est 30 jours, et le formulaire indique sous le champ le jour où la clé expirera. Avec **Date personnalisée**, choisis ce jour dans le calendrier **Date d'expiration**, parmi les dates disponibles. Une clé avec une date d’expiration doit rester valide au moins 24 heures et au plus 365 jours. Après un changement d’heure, la première date disponible peut être après demain.
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

Les propriétaires et admins peuvent révoquer toute clé créée ici pour un membre, une équipe, un projet ou l’organisation, et un membre les clés qu’un admin a créées pour lui. Les clés personnelles d’un membre ne sont révocables que par lui ; pour en arrêter une dans cette organisation seulement, [bloque-la](#block-a-members-own-key), et pour les couper toutes ici, désactive ou retire le membre, ou [désactive les clés personnelles des membres](#members-personal-keys) ici pour tout le monde. Une telle clé se gère uniquement dans son organisation : sa création et sa révocation y sont consignées, avec la personne qui l’a créée ou révoquée.

Une ancienne date de **Dernière utilisation** ne suffit pas à justifier une révocation. Une tâche mensuelle ou une procédure de récupération peut rester longtemps inactive. Vérifie d’abord le logiciel indiqué par le nom de la clé.

## Bloquer la clé personnelle d’un membre {#block-a-members-own-key}

La clé personnelle d’un membre fonctionne dans chaque organisation dont il fait partie, sauf si cette organisation a [désactivé les clés personnelles des membres](#members-personal-keys). Un propriétaire ou un admin peut l’arrêter dans cette organisation seulement : dans **Paramètres > Membres**, ouvre le menu de la ligne du membre et sélectionne **Clés API personnelles**. La boîte de dialogue liste les clés personnelles du membre encore valides, chacune marquée **Fonctionne ici** ou **Bloquée ici**, ou **Refusée ici** tant que cette organisation a désactivé les clés personnelles des membres ; si ce paramètre ne peut pas être lu, la boîte de dialogue le dit et ne marque que les clés bloquées. Sélectionne **Bloquer** et confirme avec **Bloquer la clé**. La requête suivante de la clé vers cette organisation est refusée avec `403 API_KEY_BLOCKED`, dont la réponse liste les organisations où elle fonctionne encore ; le blocage ne s’étend pas aux autres organisations du membre, et le membre la conserve. **Lever le blocage** met fin au blocage.

Un admin voit les clés d’un propriétaire, mais ne peut ni les bloquer ni lever leur blocage ; un propriétaire peut faire les deux sur la clé de n’importe qui. Personne ne bloque sa propre clé : révoque-la plutôt. Une clé créée ici pour un membre, une équipe, un projet ou l’organisation se révoque, elle ne se bloque pas. Chaque blocage et chaque levée laissent une entrée dans le journal d’audit, avec la personne qui l’a fait et la clé désignée par ses extrémités masquées. Le membre en est informé dans ses notifications, et sa propre liste, sous **Paramètres > API > REST**, marque la clé **Bloquée dans cette organisation**.

Un blocage vaut pour la clé qu’il désigne : il ne couvre pas une nouvelle clé personnelle que le membre crée, qui doit être bloquée à son tour.

## Désactiver les clés personnelles des membres {#members-personal-keys}

Une clé qu’un membre crée pour lui-même fonctionne dans chaque organisation dont il est membre ; les propriétaires et admins décident si elle fonctionne dans la leur. Dans **Paramètres > API > REST**, la section **Clés personnelles des membres**, sous le tableau des clés, contient l’interrupteur **Les clés personnelles des membres fonctionnent ici**. Il reste activé tant que personne ne le désactive, seuls les propriétaires et admins le voient, et un changement s’applique dès la requête suivante.

Tant qu’il est désactivé, chaque clé personnelle d’un membre, la tienne comprise, est refusée pour toute requête adressée à cette organisation, par l’API REST, le point d’accès MCP et les endpoints de modèles, avec `403 API_KEY_PERSONAL_REFUSED`. Par l’API REST et le point d’accès MCP, `data.organizations` dans le refus liste les organisations du détenteur qui acceptent encore les clés personnelles des membres, où la même clé continue de fonctionner. Une réponse déjà en cours de flux se termine. Les clés créées ici pour un membre, une équipe, un projet ou l’organisation continuent de fonctionner, tout comme les sessions connectées et les [agents connectés](/fr/platform/admin/connected-agents). Réactive l’interrupteur, et les clés personnelles des membres fonctionnent de nouveau ici dès leur requête suivante. Chaque changement laisse une entrée dans le journal d’audit, sous **Paramètres > Gouvernance > Journaux**, avec le paramètre avant et après.

Un membre dont les clés personnelles sont refusées ici voit **Tes clés personnelles ne fonctionnent pas ici** dans **Paramètres > API > REST** ; quiconque peut créer une clé peut toujours en créer une, qui fonctionne dans ses autres organisations. Si Tale ne peut pas lire le paramètre, il refuse les clés personnelles des membres avec `503 PERSONAL_KEYS_POLICY_UNAVAILABLE` jusqu’à ce qu’il le puisse : les membres voient **Tes clés personnelles sont suspendues ici**, et les propriétaires et admins voient, à la place de la section, que la politique n’a pas pu être lue, avec **Réessayer**.

## Comprendre les permissions et les limites

Un changement de rôle s’applique aux requêtes suivantes des clés existantes. Désactiver l’adhésion de leur propriétaire retire ses accès ; la clé ne conserve pas le rôle qu’elle avait à sa création. Perdre le rôle ou le droit qui te permettait de créer des clés laisse en place celles que tu détiens : **Paramètres > API > REST** continue de les lister pour que tu les révoques, mais n’en propose plus de nouvelle. Si Tale ne peut pas vérifier ton accès, **Paramètres > API** le signale et propose **Réessayer** au lieu de te refuser l’accès ; les pages que Tale a pu confirmer restent ouvertes.

Donne à une intégration uniquement les accès dont elle a besoin. Un service qui synchronise les notifications n’a par exemple pas besoin d’un compte Admin : un Admin peut accorder à un membre ordinaire le droit `tale:notifications.export`. Il permet cet export sans aucun autre droit du rôle Admin, ne vaut que dans l’organisation, peut expirer et prend fin quand le membre est retiré. Attribue-le dans [Droits et qualifications](/fr/platform/admin/governance/rights-and-qualifications), où une intégration qui relaie les réponses et les décisions de relecture de personnes reçoit de la même façon `tale:rest.act-as` ; [Déléguer l’export sans rôle Admin](/fr/develop/api-reference#deleguer-lexport-sans-role-admin) décrit le côté API.

Les limites de débit REST s’appliquent au propriétaire authentifié de la clé. Plusieurs clés d’une même personne ne donnent pas de quotas de débit distincts, tandis qu’une clé qu’un propriétaire ou un admin a créée pour un membre, une équipe, un projet ou l’organisation a son propre quota. Consulte [les limites de débit](/fr/develop/rate-limits). Une [règle de budget](/fr/platform/admin/governance/policies-and-limits) peut aussi plafonner ce que les requêtes authentifiées par une clé précise peuvent dépenser : leur usage est imputé à la clé, et un envoi ou un appel de modèle au-delà du plafond est refusé avec `429 BUDGET_EXCEEDED`. Les exécutions d’automatisation lancées avec la clé comptent aussi pour elle, en plus des limites personnelles du membre pour lequel la clé agit. Une clé créée pour un membre compte pour les limites de ce membre, comme sa propre clé. La clé d’une équipe, d’un projet ou de l’organisation dépense en son propre nom : aucune limite personnelle, de rôle ou par défaut ne s’applique à elle, mais les limites de l’organisation et toute règle visant la clé s’appliquent, la clé d’une équipe compte aussi pour la limite de son équipe, qui la plafonne, et la clé d’un projet de même pour la limite de son projet. L’analyse de l’usage présente une telle clé sur sa propre ligne, jamais comme utilisateur actif. [Comment l’usage est compté](/fr/platform/admin/governance/usage-attribution) décrit la règle complète.

Une clé peut aussi appeler les modèles de l’organisation depuis des outils comme opencode ou Claude Code, par les [endpoints de modèles](/fr/develop/use-tale-from-your-editor#model-endpoints), dès qu’un admin les a activés dans [Modèles](/fr/platform/admin/governance/content-models#model-endpoints). La personne qui la détient doit être propriétaire, admin ou développeur, ou détenir **Appeler les modèles par l'API**. Ces appels comptent pour les règles de budget de la clé comme ses messages de chat, et ils apparaissent comme **Appel API direct** dans l’analyse de l’usage, au nom de la personne et de la clé.

Un agent de code compatible peut se connecter lui-même au point d’accès MCP et n’a alors pas besoin de clé ; [Agents connectés](/fr/platform/admin/connected-agents) explique comment une personne connecte un agent et met fin à sa connexion. Les clés API authentifient les logiciels qui appellent Tale. Les [identifiants des connectors](/fr/platform/admin/connectors) servent dans l’autre sens : ils permettent à Tale d’appeler un service externe. [Utiliser Tale depuis ton éditeur ou un script](/fr/develop/use-tale-from-your-editor) montre où placer une clé dans opencode, Claude Code et un script shell.
