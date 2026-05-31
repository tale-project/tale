---
title: Intégrations (vue Admin)
description: Paramètres > Intégrations est l'endroit où les Administrateurs installent, configurent et rotent les identifiants derrière Slack, Gmail, Outlook, Microsoft 365, Google Drive, Confluence, WebDAV, GitHub, Shopify, Tavily et MCP. Cette page couvre la surface admin, pas la liste des fonctionnalités par intégration.
---

Paramètres > Intégrations est la surface des identifiants pour chaque système tiers avec lequel Tale parle au nom de l'organisation. Les Administrateurs installent les intégrations une fois ; les agents, workflows et la pipeline documents les utilisent partout ailleurs. Cette page couvre le côté admin — ce que montre la liste, comment marchent installation et rotation, ce qu'un Admin peut scoper, et en quoi la surface diffère des serveurs MCP.

L'histoire fonctionnelle de chaque intégration (ce qu'elle fait, quels périmètres elle demande, ce qu'un agent peut appeler) vit un onglet plus loin sur les pages par intégration et dans la page de concept inter-intégrations. Ce qui suit est la surface opérations : installer, roter, restreindre, révoquer.

## Ce que la liste montre

Ouvre **Paramètres > Intégrations** pour atterrir sur les intégrations installées de l'org. Chaque ligne nomme une intégration, montre sa catégorie (communication, stockage, identité, connaissance, contrôle de source, commerce, IA), le type d'identifiant (OAuth2, clé API, jeton d'app) et le statut de connexion (connectée, en attente, erreur). La liste est filtrable par catégorie et par statut.

Le catalogue des intégrations disponibles est à un clic sous **Ajouter une intégration**. Le catalogue ship actuellement Slack, Microsoft Teams, Discord, Gmail, Outlook, Twilio, Microsoft 365, Google Drive, Confluence, WebDAV, Tavily, GitHub, Shopify, Protel, Circuly et AI image ; le même catalogue est la source que documente la vue d'ensemble des intégrations.

## Installer une intégration

Choisis une intégration du catalogue et clique sur **Connecter**. L'intégration déclare le type d'identifiant qu'elle attend et les périmètres dont elle a besoin ; Tale exécute la danse OAuth pour les intégrations OAuth et montre un formulaire pour les intégrations à clé API. Une fois l'identifiant déposé, Tale le vérifie avec un appel à vide vers le système amont avant d'enregistrer — un échec apparaît comme erreur de connexion avec le message amont attaché.

Certaines intégrations portent des sous-options à l'installation. Microsoft 365 te laisse choisir s'il faut activer la sync OneDrive, la sync SharePoint, les deux, ou seulement le SSO ; GitHub te laisse choisir les dépôts auxquels l'org accorde l'accès ; Slack demande dans quels canaux le bot peut poster. Les sous-options peuvent être modifiées plus tard depuis la ligne de l'intégration sans réinstaller.

## Roter les identifiants

Pour roter, ouvre la ligne de l'intégration et clique sur **Roter les identifiants**. Les intégrations OAuth refont la danse avec les mêmes périmètres ; les intégrations à clé API montrent un champ pour la nouvelle clé. L'ancien identifiant arrête de marcher dès que le nouveau est vérifié — il n'y a pas de fenêtre de chevauchement pour les identifiants au niveau de l'intégration. Va vers la rotation au rythme que ta politique de sécurité impose, ou chaque fois que le système amont rapporte un identifiant compromis.

## Restreindre une intégration

Au-delà des identifiants, une intégration porte deux leviers de cadrage sous sa ligne :

- **Rôles autorisés.** Restreins quels rôles peuvent appeler l'intégration depuis leurs agents et workflows. Le défaut est chaque rôle écrivain (Éditeur, Développeur, Administrateur, Propriétaire) ; le rétrécir est la façon de garder, disons, l'intégration Twilio hors des agents construits par des Membres.
- **Équipes autorisées.** Restreins quelles équipes peuvent appeler l'intégration depuis leurs agents et workflows. Utile quand l'identifiant appartient au travail d'une équipe (le Slack de l'équipe support) et que tu ne veux pas qu'il fuie vers une autre.

Les deux leviers sont appliqués à la requête, pas à l'installation — changer un levier prend effet au prochain appel.

## Révoquer une intégration

Clique la ligne, puis **Déconnecter**. Une intégration déconnectée arrête d'authentifier immédiatement ; les agents et workflows qui en dépendent font remonter une erreur de configuration au prochain appel. La ligne reste dans la liste avec un badge déconnecté pour que la piste d'audit survive. Reconnecter parcourt le flux d'identifiants de zéro.

## Bot Slack et notifications

Slack est bidirectionnel. Au-delà de l'agent qui appelle Slack (poster des messages, lire des canaux), l'org peut laisser des personnes parler à un agent depuis Slack et pousser des événements système dans un canal. Les deux se configurent sur la ligne Slack connectée, et les deux utilisent le même identifiant OAuth — pas de seconde connexion.

Faire tourner le bot demande une étape opérateur unique : une app Slack partagée dont `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` et `SLACK_SIGNING_SECRET` sont définis sur le déploiement (voir [Référence d'environnement](/fr/self-hosted/configuration/environment-reference)), avec les Event Subscriptions pointées sur `https://<ton-hôte>/api/integrations/slack/events` et les événements bot `app_mention` et `message.im` abonnés. Chaque org installe ensuite cette app avec son propre flux OAuth ; les messages entrants sont routés vers la bonne org via l'espace de travail Slack.

Sur la ligne Slack connectée, un admin choisit **quel agent répond sur Slack** (une mention dans un canal ou un message direct démarre une réponse en thread de cet agent) et **quels canaux reçoivent les notifications**, avec une bascule par événement. Les événements livrés sont workflow échoué, workflow terminé et alertes de sécurité ; un thread Slack correspond à une conversation d'agent, et l'auteur Slack y est conservé plutôt qu'enregistré comme le système.

## Intégrations versus serveurs MCP

Deux surfaces laissent un agent atteindre au-delà de Tale. Les **Intégrations** sont les connecteurs spécifiques au fournisseur, premier-party, documentés ici. Les **serveurs MCP** sont des processus externes qui exposent le Model Context Protocol ; l'org les enregistre sous **Paramètres > Serveurs MCP** et approuve chaque tool à son premier appel. Va vers une intégration quand une existe pour le système cible ; va vers les [serveurs MCP](/fr/platform/integrations/mcp-servers) quand aucune intégration ne couvre ton besoin.

## Où cela s'inscrit

Les intégrations sont la moitié identifiants de l'histoire agent-vers-monde-extérieur ; la moitié agent (quels tools un agent obtient, comment il les appelle, à quoi ressemble la frontière de confiance) vit sous [Tools agents](/fr/platform/agents/tools). La lecture naturelle suivante pour un nouvel admin est [Vue d'ensemble des intégrations](/fr/platform/integrations/overview) — elle nomme chaque intégration livrée groupée par ce qu'elle fait et donne le setup par intégration d'un coup d'œil.
