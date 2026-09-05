---
title: Clés API
description: Identifiants Bearer personnels qui permettent à du code externe d’appeler l’API REST de Tale.
---

Les clés API sont les identifiants que Tale émet pour qu’un code externe appelle son API REST sans humain dans la boucle. Une clé authentifie l’appelant comme étant la personne qui l’a fabriquée, et porte le rôle de cette personne dans l’organisation. Les Administrateurs et Développeurs gèrent les clés ; les autres rôles ne voient pas la page. Voilà la référence pour ce qu’est une clé, comment en créer une, comment elle est scopée, et comment la retirer sans casser ce qui en dépend.

Les clés listées ici sont différentes des jetons de session par utilisateur que Tale émet à la connexion. Ceux-ci sont de courte durée et liés à un navigateur ; les clés API sont de longue durée et pensées pour des appelants sans surveillance. Va vers une clé API quand tu branches un script, une tâche cron, un service interne, ou une connector tierce à Tale ; va vers l’UI en-produit quand une personne est au clavier.

<Frame caption="Paramètres > API > REST — là où les clés sont créées, rotées et révoquées.">

![La page de paramètres des clés API REST listant deux clés dont chacune n’affiche que son préfixe, sa date d’ajout et la mention Jamais utilisée, à côté d’un bouton Créer une clé API.](/images/get-started/settings-api-keys.webp)

</Frame>

## Créer une clé

Ouvre **Paramètres > API > REST** et clique sur **Créer une clé API**. Donne à la clé un nom qui dit qui ou quoi va l’utiliser (`Sync facturation`, `Relais Slack`, `ops-cron`) et choisis l’expiration — 7, 30 ou 90 jours, un an, ou jamais ; 30 jours par défaut. Tale montre le secret exactement une fois à la création — copie-le dans ton gestionnaire de mots de passe ou ton système de déploiement avant de fermer la boîte de dialogue. Après, la table n’en montre plus qu’un fragment masqué.

La clé agit comme toi : chaque requête qu’elle fait porte ton rôle dans l’organisation. Une clé fabriquée par un Développeur peut lire chaque ressource et écrire dans la plupart ; il n’existe pas de clé plus puissante que la personne qui l’a créée. Les clés étant aussi dangereuses que le rôle derrière elles, laisse le compte le moins privilégié qui fait le job fabriquer la clé.

## Ce que la table montre

La table liste les clés que tu as créées — celles de tes collègues n’apparaissent pas ici — chacune par nom, fragment masqué du secret (les premiers et derniers caractères), date d’ajout et horodatage de dernière utilisation. Le fragment suffit pour relier une ligne à la clé que tu détiens sans l’exposer. L’horodatage de dernière utilisation s’actualise à chaque requête réussie que fait la clé ; une clé non utilisée depuis des semaines est généralement sûre à retirer.

Pas de recherche ni de ligne de filtre — une org détient une poignée de clés, et un nommage délibéré garde la table lisible.

## Roter une clé

Pour roter, crée d’abord la nouvelle clé, déploie-la sur le système qui utilise l’ancienne, vérifie que la nouvelle fonctionne (l’horodatage de dernière utilisation s’actualise), et alors seulement révoque l’ancienne. Tale n’autorote pas les clés ; la discipline du chevauchement est la tienne. La rotation est le bon mouvement quand on soupçonne une fuite, quand quelqu’un ayant accès à la clé quitte l’organisation, ou au rythme que ta politique de sécurité impose.

## Révoquer une clé

Ouvre le menu de la ligne, clique sur **Révoquer la clé**, puis confirme. Une clé révoquée arrête d’authentifier immédiatement — toute requête en vol se termine, mais la suivante échoue avec `401` — et la ligne disparaît de la table. Pas d’annulation pour la révocation ; si tu révoques la mauvaise clé, fabriques-en une nouvelle.

## Périmètres et limites

Chaque clé porte les permissions du rôle de son créateur au moment de chaque requête, pas au moment de la création. Change le rôle de la personne — ou désactive son adhésion — et chaque clé qu’elle a fabriquée hérite du changement à la requête suivante. Les requêtes vers l’API REST sont limitées en débit par adresse appelante, et une [règle de budget de gouvernance](/fr/platform/admin/governance/policies-and-limits) peut plafonner ce qu’une clé dépense en modèles.

## Où cela s’inscrit

Les clés API sont le pont entre Tale et le code externe ; elles s’asseyent à côté des [Connectors](/fr/platform/admin/connectors) (systèmes tiers que Tale appelle) et des [déclencheurs webhook des automatisations](/fr/platform/automations/triggers) (systèmes qui appellent Tale sur événement). La lecture suivante naturelle est l’API REST elle-même — voir la référence API dans l’onglet Develop pour la surface contre laquelle une clé authentifie, et voir [Membres et rôles](/fr/platform/admin/members-and-roles) pour la carte rôle-vers-permission que chaque clé hérite.
