---
title: Intégrations (vue Admin)
description: Paramètres > Intégrations est l’endroit où les Administrateurs installent, configurent et rotent les identifiants derrière Slack, Gmail, Outlook, Microsoft 365, Google Drive, Confluence, WebDAV, GitHub, Shopify, Tavily et MCP. Cette page couvre la surface admin, pas la liste des fonctionnalités par intégration.
---

Paramètres > Intégrations est la surface des identifiants pour chaque système tiers avec lequel Tale parle au nom de l’organisation. Les Administrateurs installent les intégrations une fois ; les agents, workflows et la pipeline documents les utilisent partout ailleurs. Cette page couvre le côté admin — ce que montre la liste, comment marchent installation et rotation, ce qu’un Admin peut scoper, et en quoi la surface diffère des serveurs MCP.

L’histoire fonctionnelle de chaque intégration (ce qu’elle fait, quels périmètres elle demande, ce qu’un agent peut appeler) vit un onglet plus loin sur les pages par intégration et dans la page de concept inter-intégrations. Ce qui suit est la surface opérations : installer, roter, restreindre, révoquer.

<Frame caption="Le catalogue des intégrations sous Ajouter une intégration — chaque connecteur que Tale embarque, filtrable par catégorie.">

![Le catalogue des intégrations montrant une grille de cartes de connecteurs — Slack, Gmail, Google Drive, GitHub, Tavily et plus — chacune avec une action Connecter.](/images/platform/integrations-catalog.webp)

</Frame>

## Ce que la liste montre

Ouvre **Paramètres > Intégrations** pour atterrir sur les intégrations installées de l’org. Chaque ligne nomme une intégration, montre sa catégorie (communication, stockage, identité, connaissance, contrôle de source, commerce, IA), le type d’identifiant (OAuth2, clé API, jeton d’app) et le statut de connexion (connectée, en attente, erreur). La liste est filtrable par catégorie et par statut.

Le catalogue des intégrations disponibles est à un clic sous **Ajouter une intégration**. Le catalogue ship actuellement Slack, Microsoft Teams, Discord, Gmail, Outlook, Twilio, Microsoft 365, Google Drive, Confluence, WebDAV, Tavily, GitHub, Shopify et AI image ; le même catalogue est la source que documente la vue d’ensemble des intégrations.

## Installer une intégration

Choisis une intégration du catalogue et clique sur **Connecter**. L’intégration déclare le type d’identifiant qu’elle attend et les périmètres dont elle a besoin ; Tale exécute la danse OAuth pour les intégrations OAuth et montre un formulaire pour les intégrations à clé API. Une fois l’identifiant déposé, Tale le vérifie avec un appel à vide vers le système amont avant d’enregistrer — un échec apparaît comme erreur de connexion avec le message amont attaché.

Certaines intégrations portent des sous-options à l’installation. Microsoft 365 te laisse choisir s’il faut activer la sync OneDrive, la sync SharePoint, les deux, ou seulement le SSO ; GitHub te laisse choisir les dépôts auxquels l’org accorde l’accès ; Slack demande dans quels canaux le bot peut poster. Les sous-options peuvent être modifiées plus tard depuis la ligne de l’intégration sans réinstaller.

## Mettre à jour les définitions depuis le catalogue livré

La définition de chaque intégration — son schéma de configuration, son connecteur, son icône — est copiée dans l’organisation à sa création et reste intacte ensuite ; une mise à jour de la plateforme ne la change donc jamais dans ton dos. **Mettre à jour les intégrations livrées** dans le menu **Ajouter une intégration** remplace chaque définition livrée qui diffère du catalogue courant par la dernière version. Les identifiants, les secrets et les intégrations que tu as ajoutées toi-même restent intacts ; la version précédente de chaque définition remplacée est conservée sur le serveur, pour qu’un opérateur puisse la récupérer.

## Roter les identifiants

Pour roter, ouvre la ligne de l’intégration et clique sur **Roter les identifiants**. Les intégrations OAuth refont la danse avec les mêmes périmètres ; les intégrations à clé API montrent un champ pour la nouvelle clé. L’ancien identifiant arrête de marcher dès que le nouveau est vérifié — il n’y a pas de fenêtre de chevauchement pour les identifiants au niveau de l’intégration. Va vers la rotation au rythme que ta politique de sécurité impose, ou chaque fois que le système amont rapporte un identifiant compromis.

Quand une mise à jour de la plateforme ajoute des périmètres à une intégration OAuth déjà connectée, rote une fois pour que l’écran de consentement les accorde. **Outlook** est le cas actuel : après la mise à jour qui lit l’adresse du compte pour la rédaction, les connexions Outlook existantes doivent roter une fois avant que la rédaction affiche la vraie adresse plutôt que le seul nom du fournisseur — jusqu’alors l’envoi continue de marcher ; seule la capture d’adresse attend le nouveau périmètre `User.Read`.

## Restreindre une intégration

Au-delà des identifiants, une intégration porte deux leviers de cadrage sous sa ligne :

- **Rôles autorisés.** Restreins quels rôles peuvent appeler l’intégration depuis leurs agents et workflows. Le défaut est chaque rôle écrivain (Éditeur, Développeur, Administrateur, Propriétaire) ; le rétrécir est la façon de garder, disons, l’intégration Twilio hors des agents construits par des Membres.
- **Équipes autorisées.** Restreins quelles équipes peuvent appeler l’intégration depuis leurs agents et workflows. Utile quand l’identifiant appartient au travail d’une équipe (le Slack de l’équipe support) et que tu ne veux pas qu’il fuie vers une autre.

Les deux leviers sont appliqués à la requête, pas à l’installation — changer un levier prend effet au prochain appel.

## Révoquer une intégration

Clique la ligne, puis **Déconnecter**. Une intégration déconnectée arrête d’authentifier immédiatement ; les agents et workflows qui en dépendent font remonter une erreur de configuration au prochain appel. La ligne reste dans la liste avec un badge déconnecté pour que la piste d’audit survive.

Déconnecter conserve l’identifiant enregistré : la ligne propose donc **Reconnecter** — un clic, rien à retaper. Tale teste d’abord l’identifiant enregistré et ne marque l’intégration comme connectée que s’il fonctionne toujours ; si le mot de passe ou la clé a changé entre-temps, le test échoue et la ligne reste déconnectée — un identifiant périmé n’a donc jamais l’air sain. **Utiliser d’autres identifiants** permet d’en saisir un nouveau à la place. Les intégrations OAuth se reconnectent via l’écran de consentement du fournisseur, car une autorisation révoquée ne se rétablit qu’en autorisant à nouveau. Reconnecter réactive aussi les agents que la déconnexion avait désactivés et relance les automatisations liées à l’intégration.

**Retirer la connexion** va plus loin que Déconnecter : l’identifiant enregistré est supprimé. Le modèle de l’intégration reste au catalogue, tu peux donc la reconnecter plus tard en saisissant de nouveaux identifiants.

## Faire tourner deux fois la même intégration

Certaines intégrations servent plusieurs fois — deux boîtes mail, deux bases de données, deux locataires d’API. Ouvre l’intégration et choisis **Dupliquer** (également dans le menu ⋯ de la ligne) pour créer une seconde instance. Tale copie la configuration de l’intégration sous un nouveau nom (`Boîte support (2)`), laisse son identifiant vide pour que tu le renseignes, et clone toute automatisation liée à l’originale afin que la copie ait sa propre synchronisation et son propre fil de réception.

La copie démarre déconnectée et reste au repos : aucune exécution planifiée ne se déclenche avant que tu saisisses ses identifiants et la connectes, donc un doublon non configuré ne produit jamais d’exécutions en échec. Dupliquer n’est proposé que là où une seconde instance peut réellement fonctionner : les intégrations OAuth (Gmail, Outlook, Slack) et GitHub sont liées à leur identité exacte chez le fournisseur et ne peuvent donc pas être dupliquées.

Un doublon se retire entièrement. Tant qu’il est déconnecté, son panneau propose **Supprimer**, ce qui retire l’instance, son identifiant et les automatisations clonées pour elle. Les intégrations livrées ne proposent jamais Supprimer : elles ne peuvent qu’être déconnectées, pour que le modèle survive à la prochaine connexion.

## Bot Slack et notifications

Slack est bidirectionnel. Au-delà de l’agent qui appelle Slack (poster des messages, lire des canaux), l’org peut laisser des personnes parler à un agent depuis Slack et pousser des événements système dans un canal. Les deux se configurent sur la ligne Slack connectée, et les deux utilisent le même identifiant OAuth — pas de seconde connexion.

Chaque org apporte sa propre app Slack, configurée entièrement depuis la ligne Slack — il n’y a rien à définir sur le déploiement. Quand tu connectes Slack, la ligne affiche un panneau **Configurer votre application Slack** avec un manifeste d’app prêt à coller et les deux URLs auxquelles il fait référence : l’URL de requête des Event Subscriptions (`/api/integrations/slack/events`) et l’URL de redirection OAuth. Le manifeste pré-remplit les portées du bot, les événements `app_mention` et `message.im` ainsi que les deux URLs, si bien que créer l’app sur api.slack.com/apps ne prend que quelques clics. Recolle l'**ID client**, le **Secret client** et le **Secret de signature** de l’app dans la ligne, puis autorise via OAuth. Le secret de signature est ce qui vérifie les événements entrants, donc le bot reste muet tant qu’il n’est pas défini ; les messages entrants sont routés vers la bonne org via l’espace de travail Slack.

Sur la ligne Slack connectée, un admin choisit **quel agent répond sur Slack** (une mention dans un canal ou un message direct démarre une réponse en thread de cet agent) et **quels canaux reçoivent les notifications**, avec une bascule par événement. Les événements livrés sont workflow échoué, workflow terminé et alertes de sécurité ; un thread Slack correspond à une conversation d’agent, et l’auteur Slack y est conservé plutôt qu’enregistré comme le système.

## Intégrations versus serveurs MCP

Deux surfaces laissent un agent atteindre au-delà de Tale. Les **Intégrations** sont les connecteurs spécifiques au fournisseur, premier-party, documentés ici. Les **serveurs MCP** sont des processus externes qui exposent le Model Context Protocol ; l’org les enregistre sous **Paramètres > Serveurs MCP** et approuve chaque tool à son premier appel. Va vers une intégration quand une existe pour le système cible ; va vers les [serveurs MCP](/fr/platform/integrations/mcp-servers) quand aucune intégration ne couvre ton besoin.

## Où cela s’inscrit

Les intégrations sont la moitié identifiants de l’histoire agent-vers-monde-extérieur ; la moitié agent (quels tools un agent obtient, comment il les appelle, à quoi ressemble la frontière de confiance) vit sous [Tools agents](/fr/platform/agents/tools). La lecture naturelle suivante pour un nouvel admin est [Vue d’ensemble des intégrations](/fr/platform/integrations/overview) — elle nomme chaque intégration livrée groupée par ce qu’elle fait et donne le setup par intégration d’un coup d'œil.
