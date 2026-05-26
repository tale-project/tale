---
title: Intégrations
description: Systèmes tiers que Tale lit et écrit — communication, stockage, identité, dev, connaissances — et en quoi la surface des intégrations diffère de MCP.
---

Les intégrations sont les ponts entre Tale et le reste de ta pile. Les agents les appellent comme outils, les workflows les déclenchent à des étapes, et la pipeline de documents en tire des fichiers. Chaque intégration est une seule configuration JSON plus un identifiant que l'organisation enregistre une fois ; une fois connectée, n'importe quoi dans Tale peut l'utiliser sans nouvelle authentification. Cet aperçu nomme les intégrations livrées, groupées par ce qu'elles font.

La forme d'une intégration est la même pour chaque entrée ci-dessous — une surface REST compatible OpenAI ou une danse OAuth2, avec des opérations déclarées dans une configuration JSON sous `examples/integrations/`. Les intégrations personnalisées suivent la même forme ; tu n'as pas besoin de modifier le code pour en ajouter une.

## En quoi les intégrations diffèrent de MCP

Deux surfaces permettent à un agent de tendre la main au-delà de Tale. Les **intégrations** sont des connecteurs natifs, sécurisés par OAuth ou par clé API, que l'organisation configure une fois sous **Paramètres > Intégrations**. Les **serveurs MCP** sont des processus externes (souvent auto-hébergés) qui exposent le Model Context Protocol ; l'organisation les enregistre sous **Paramètres > MCP servers** et approuve chaque outil au premier appel. Va vers une intégration quand il en existe une pour ton système cible ; va vers les [serveurs MCP](/fr/platform/integrations/mcp-servers) quand aucune intégration ne couvre ce dont tu as besoin et que tu peux héberger le pont toi-même.

## Communication

| Intégration | Ce qu'elle fait                                               | Mise en place                     |
| ----------- | ------------------------------------------------------------- | --------------------------------- |
| **Slack**   | Lire des canaux, envoyer des messages, réagir aux événements. | OAuth2 depuis l'espace Slack.     |
| **Teams**   | Même forme pour Microsoft Teams — canaux et chats.            | OAuth via Microsoft Entra ID.     |
| **Discord** | Envoi de messages et lecture de canaux pilotés par bot.       | Token de bot Discord.             |
| **Gmail**   | Lire la boîte, envoyer des mails, étiqueter.                  | OAuth via Google.                 |
| **Outlook** | Lire la boîte, envoyer des mails, lecture du calendrier.      | OAuth via Microsoft Entra ID.     |
| **Twilio**  | SMS, voix, WhatsApp Business.                                 | Account SID et auth token Twilio. |

## Stockage et documents

| Intégration       | Ce qu'elle fait                                                                                                                    | Mise en place                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Microsoft 365** | Synchronisation OneDrive et SharePoint dans [Knowledge](/fr/platform/knowledge/documents) ; single sign-on via Microsoft Entra ID. | OAuth via Microsoft Entra ID ; le même tenant pilote SSO et synchro documents. |
| **Google Drive**  | Tirer des fichiers depuis des dossiers Drive dans Knowledge.                                                                       | OAuth via Google.                                                              |
| **Confluence**    | Tirer des pages Confluence dans Knowledge ; les agents citent la page source.                                                      | Token API + base URL (cloud ou auto-hébergé).                                  |
| **WebDAV**        | Lire des dossiers depuis n'importe quel serveur WebDAV (Nextcloud, ownCloud, générique).                                           | URL du serveur, nom d'utilisateur, mot de passe.                               |

Les documents synchronisés via l'une de ces sources passent par la même pipeline d'indexation que les téléversements directs — voir [Documents](/fr/platform/knowledge/documents). Le champ source de chaque document indexé nomme l'intégration pour que les citations pointent vers l'original.

## Identité

Microsoft 365 couvre aussi l'identité. La connecter sous **Paramètres > Intégrations** active la lecture OneDrive et SharePoint ; la connecter sous **Paramètres > Authentification** active le single sign-on pour toute l'organisation via le même tenant Entra ID. Les deux chemins partagent identifiants et règles de provisionnement — voir [Membres et rôles](/fr/platform/admin/members-and-roles) pour le mapping de rôles.

## Connaissances et recherche

| Intégration | Ce qu'elle fait                                                                                                | Mise en place                |
| ----------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **Tavily**  | Recherche web ouverte et extraction de pages pour la [Recherche approfondie](/fr/platform/chat/deep-research). | Clé API depuis `tavily.com`. |

## Source

| Intégration | Ce qu'elle fait                                             | Mise en place                  |
| ----------- | ----------------------------------------------------------- | ------------------------------ |
| **GitHub**  | Lire des dépôts, chercher du code, réagir aux issues et PR. | App GitHub ou token personnel. |

## Vertical : commerce et hospitalité

| Intégration | Ce qu'elle fait                                             | Mise en place              |
| ----------- | ----------------------------------------------------------- | -------------------------- |
| **Shopify** | Lire commandes, clients et produits.                        | Token API Admin Shopify.   |
| **Protel**  | PMS hôtelier — lire réservations et données invités.        | Clé API + ID de propriété. |
| **Circuly** | Plateforme de commerce d'abonnement — lire les abonnements. | Clé API.                   |

## Services IA

| Intégration  | Ce qu'elle fait                                                                   | Mise en place                                                                                                           |
| ------------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **AI image** | Surface de génération d'images qui enveloppe les modèles tagués image configurés. | Aucune mise en place — utilise les fournisseurs de modèles sous [Paramètres > Providers](/fr/platform/admin/providers). |

## Ajouter une intégration personnalisée

Les intégrations personnalisées suivent la même forme JSON que celles ci-dessus. Dépose une configuration dans `TALE_CONFIG_DIR/integrations/<slug>/config.json` déclarant les opérations, la méthode d'auth et les hôtes autorisés ; l'intégration apparaît sous **Paramètres > Intégrations** pour que les utilisateurs la connectent. La forme et les règles de validation vivent à côté des configurations livrées dans `examples/integrations/`.

Pour des ponts plus riches ou auto-hébergés, les [serveurs MCP](/fr/platform/integrations/mcp-servers) sont la surface alternative — chaque serveur MCP que tu enregistres ajoute ses outils à la ceinture d'outils de l'agent avec approbation par outil.

## Où ça s'inscrit

Les intégrations sont la façon dont les agents agissent sur le monde hors de Tale. La lecture suivante dépend de pourquoi tu es venu — pour l'auteur d'agent, [Outils d'agent](/fr/platform/agents/tools) explique comment les opérations d'une intégration apparaissent comme une famille d'outils sur l'agent ; pour l'admin org, [Paramètres > Intégrations](/fr/platform/admin/integrations) est où les identifiants sont stockés et tournés ; pour le développeur qui câble quelque chose de nouveau, [Serveur MCP depuis zéro](/fr/tutorials/developer/mcp-server-from-scratch) est la construction de bout en bout d'un pont personnalisé.
