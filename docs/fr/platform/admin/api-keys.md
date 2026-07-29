---
title: Clés API
description: Identifiants à l’échelle de l’org qui permettent à du code externe d’appeler l’API REST de Tale au nom de l’organisation. Les Administrateurs et Développeurs les créent, rotent et révoquent sous Paramètres > Clés API.
---

Les clés API sont les identifiants à l’échelle de l’org que Tale émet pour qu’un code externe appelle son API REST sans humain dans la boucle. Une clé authentifie l’appelant comme étant l’organisation, scopée par le rôle que tu choisis quand tu la fabriques. Les Administrateurs et Développeurs gèrent les clés ; les autres rôles ne voient pas la page. Voilà la référence pour ce qu’est une clé, comment en créer une, comment la scoper, et comment la retirer sans casser ce qui en dépend.

Les clés listées ici sont différentes des jetons de session par utilisateur que Tale émet à la connexion. Ceux-ci sont de courte durée et liés à une personne ; les clés API sont de longue durée et liées à l’organisation. Va vers une clé API quand tu branches un script, une tâche cron, un service interne, ou une connector tierce à Tale ; va vers l’UI en-produit quand une personne est au clavier.

<Frame caption="Paramètres > Clés API — là où les clés sont créées, rotées et révoquées.">

![La page de paramètres des clés API REST listant deux clés dont chacune n’affiche que son préfixe, sa date d’ajout et la mention Jamais utilisée, à côté d’un bouton Créer une clé API.](/images/get-started/settings-api-keys.webp)

</Frame>

## Créer une clé

Ouvre **Paramètres > Clés API** et clique sur **Créer une clé API**. Donne à la clé un nom qui dit qui ou quoi va l’utiliser (`Sync facturation`, `Relais Slack`, `ops-cron`), choisis le rôle qu’elle doit porter, et choisis l’expiration. Tale montre le secret exactement une fois à la création — copie-le dans ton gestionnaire de mots de passe ou ton système de déploiement avant de fermer la boîte de dialogue. Après, seul le préfixe de la clé est visible depuis la table.

Le rôle que tu choisis scope tout ce que la clé peut faire. Une clé portant le rôle Développeur peut lire chaque ressource et écrire dans la plupart ; une clé portant le rôle Membre peut lire la base de connaissances et démarrer des chats mais rien configurer. Prends le plus petit rôle qui fait le job — les clés sont aussi dangereuses que le rôle qu’elles portent.

## Ce que la table montre

La table des clés API liste chaque clé par nom, préfixe, rôle, créateur, horodatage de dernière utilisation et expiration. Le préfixe est les huit premiers caractères du secret — assez pour identifier la clé dans les journaux sans l’exposer. L’horodatage de dernière utilisation s’actualise à chaque requête réussie que fait la clé ; une clé non utilisée depuis des semaines est généralement sûre à retirer.

La ligne de filtre te laisse rétrécir par rôle, créateur et fenêtre d’expiration. Le tri par défaut est « créées le plus récemment d’abord » ; le tri secondaire est « utilisées le plus récemment ».

## Roter une clé

Pour roter, crée d’abord la nouvelle clé, déploie-la sur le système qui utilise l’ancienne, vérifie que la nouvelle fonctionne (l’horodatage de dernière utilisation s’actualise), et alors seulement révoque l’ancienne. Tale n’autorote pas les clés ; la discipline du chevauchement est la tienne. La rotation est le bon mouvement quand on soupçonne une fuite, quand quelqu’un ayant accès à la clé quitte l’organisation, ou au rythme que ta politique de sécurité impose.

## Révoquer une clé

Clique la ligne, puis **Révoquer**. Une clé révoquée arrête d’authentifier immédiatement — toute requête en vol se termine, mais la suivante échoue avec `401`. Les clés révoquées restent dans la table pour la piste d’audit ; la ligne les marque comme révoquées et montre qui les a révoquées et quand. Pas d’annulation pour la révocation ; si tu révoques la mauvaise clé, fabriques-en une nouvelle.

## Périmètres et limites

Chaque clé porte les permissions de son rôle au moment de chaque requête, pas au moment de la création. Si tu modifies les permissions d’un rôle via une politique de gouvernance, chaque clé portant ce rôle hérite du changement à la requête suivante. Les limites de débit de l’org s’appliquent par clé, pas par organisation ; une clé bruyante ne ralentit pas une clé tranquille.

Une clé peut être restreinte plus encore par une allowlist IP à la création. L’allowlist prend une liste de blocs CIDR séparés par virgules ; les requêtes hors liste échouent avec `403`. Va vers l’allowlist IP quand le système appelant a une sortie stable et que tu veux de la défense en profondeur.

## Où cela s’inscrit

Les clés API sont le pont entre Tale et le code externe ; elles s’asseyent à côté des [Connectors](/fr/platform/admin/connectors) (systèmes tiers que Tale appelle) et des [déclencheurs webhook des automatisations](/fr/platform/automations/triggers) (systèmes qui appellent Tale sur événement). La lecture suivante naturelle est l’API REST elle-même — voir la référence API dans l’onglet Develop pour la surface contre laquelle une clé authentifie, et voir [Membres et rôles](/fr/platform/admin/members-and-roles) pour la carte rôle-vers-permission que chaque clé hérite.
