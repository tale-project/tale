---
title: Connectors
description: Les connecteurs livrés avec Tale, les identifiants que ton organisation enregistre en face, et comment les actions d’un connecteur arrivent dans les automatisations et les exécutions d’agent.
---

Une connector, c’est deux choses à la fois : un **connecteur** livré avec la plateforme, et les **identifiants** que ton organisation enregistre en face de ce connecteur. Le connecteur porte la connaissance du fournisseur — quelles actions existent, ce que chacune prend et renvoie, comment se fait la connexion — et il est identique dans toutes les organisations. Les identifiants, eux, sont à toi, et un connecteur en porte autant que nécessaire : un par espace de travail, boutique, boîte mail ou bot. Treize connecteurs sont livrés aujourd’hui, et chacun attend son premier identifiant dans le catalogue derrière **Ajouter des identifiants**, sous **Paramètres > Connectors**.

Tu préfères regarder d’abord ? L’épisode 7 parcourt les portes vers l’extérieur — connecteurs, MCP et frontières — en deux minutes et demie, sous-titres compris.

<Video src="/videos/fr/tutorials/ep7-connectors/ep7-connectors.fr.mp4" poster="/videos/fr/tutorials/ep7-connectors/ep7-connectors.fr.webp" captions="/videos/fr/tutorials/ep7-connectors/ep7-connectors.fr.vtt" lang="fr" title="Épisode 7 — Connectors & le monde extérieur" caption="Épisode 7 — Connectors & le monde extérieur (2:18)">

</Video>

## Ce qu’est un connecteur

Il n’y a rien à installer. Chaque connecteur arrive avec la plateforme, c’est pourquoi le catalogue est le même dans toutes les organisations et qu’une mise à jour suffit à le faire avancer sans que personne l’entretienne. Un connecteur est une définition : un nom affiché avec une ligne de description, les catégories auxquelles il appartient, les méthodes d’authentification qu’il accepte, et la liste des actions qu’il sait exécuter chez le fournisseur.

Comme cette définition vaut pour tout le monde, ton organisation ne décide que d’une chose : au nom de quels comptes Tale peut agir. Cette décision, ce sont les identifiants, et la configuration s’arrête là.

## Les connecteurs livrés

Treize connecteurs sont livrés, chacun marqué de la catégorie à laquelle il appartient — Knowledge, Messaging, Email, Developer, Commerce, Search ou Files. **Connexion** est la méthode d’authentification que le connecteur accepte, celle qui décide de ce que le formulaire demande ; **Actions** est le nombre d’opérations qu’il expose, le même compte que celui affiché sur sa carte dans le catalogue d’**Ajouter des identifiants**.

| Connector               | Ce que la connexion t’apporte                                                                               | Connexion                         | Actions |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------- | ------- |
| **Confluence**          | Importer des pages Confluence Cloud dans la base de connaissances de Tale.                                  | Nom d’utilisateur et mot de passe | 2       |
| **Discord**             | Poster des messages et gérer les canaux de ton serveur Discord.                                             | Jeton                             | 8       |
| **GitHub**              | Gérer dépôts, tickets et pull requests sur GitHub.                                                          | Jeton                             | 19      |
| **Gmail**               | Lire, envoyer et classer le courrier dans Gmail.                                                            | OAuth                             | 9       |
| **Google Drive**        | Importer des fichiers depuis Google Drive dans la base de connaissances de Tale.                            | OAuth                             | 2       |
| **IMAP / SMTP Mailbox** | Brancher un serveur mail IMAP + SMTP privé sur Conversations, sans compte Gmail ni Outlook.                 | Nom d’utilisateur et mot de passe | 3       |
| **Microsoft Outlook**   | Gérer le courrier, l’agenda et les contacts Outlook.                                                        | OAuth                             | 10      |
| **Shopify**             | Synchroniser produits, clients et commandes depuis ta boutique Shopify.                                     | Clé API                           | 9       |
| **Slack**               | Envoyer des messages et travailler avec les canaux dans Slack.                                              | OAuth                             | 7       |
| **Tavily**              | Recherche web en temps réel et extraction de pages pour la recherche IA.                                    | Clé API                           | 2       |
| **Microsoft Teams**     | Envoyer des messages et gérer les canaux dans Microsoft Teams.                                              | OAuth                             | 9       |
| **Twilio**              | Envoyer des SMS et passer des appels vocaux via Twilio.                                                     | Nom d’utilisateur et mot de passe | 7       |
| **WebDAV Files**        | Lire, écrire et lister les fichiers du stockage WebDAV de l’organisation — ceux que sert l’endpoint `/dav`. | Nom d’utilisateur et mot de passe | 4       |

Les pages et fichiers entrés par Confluence ou Google Drive passent par la même indexation qu’un téléversement direct, et les réponses les citent en remontant à la source — voir [Documents](/fr/platform/knowledge/documents). L’import OneDrive et SharePoint passe par Connaissances → Documents (autorisation par utilisateur), pas comme connector d’organisation. Le connecteur WebDAV est le côté écriture du stockage que tes appareils montent comme lecteur réseau, décrit dans [WebDAV](/fr/platform/connectors/webdav).

## Les identifiants d’un connecteur

Un connecteur porte autant d’identifiants que ton organisation en a besoin. Un espace Slack par entité, une boutique Shopify par marché, une boîte mail par file de support — chacun est une ligne distincte sous le connecteur, avec son propre secret et son propre état. C’est ce qui permet à une même bibliothèque d’automatisations de servir plusieurs équipes sans qu’aucune emprunte le compte d’une autre.

Chaque identifiant porte quatre choses :

- **Nom** — le nom sous lequel une action choisit ces identifiants. Écris-le pour la personne qui relira l’automatisation dans six mois : `Boîte de support`, `Boutique UE`, `Bot de release`.
- **Méthode d’authentification** — **Clé API**, **Jeton**, **Nom d’utilisateur et mot de passe** ou **OAuth**, pris dans ce que le connecteur accepte.
- **Par défaut** — un identifiant par connecteur peut l’être. Un nœud d’automatisation — ou l’appel d’un agent via le broker — qui n’en nomme aucun l’utilise.
- **État** — un identifiant est soit en service, soit **Désactivé**. Le désactiver garde la ligne et sa configuration mais empêche tout appel qui passerait par elle.

Sans identifiant par défaut, un connecteur continue de servir tous les appelants qui en nomment un ; celui qui n’en nomme aucun n’a plus rien sur quoi se rabattre. La section du connecteur le dit, et le remède est de promouvoir l’un des identifiants existants.

<Note>

Confluence et Shopify n’ont pas d’hôte unique côté fournisseur : l’API vit sur ton propre site Atlassian ou dans ta propre boutique `myshopify.com`. Les deux demandent donc une **URL de l’instance** par identifiant, et leur section porte la ligne _Chaque identifiant nomme sa propre instance._ Pointe Confluence sur l’adresse où tu ouvres Confluence, et Shopify sur l’adresse d’administration de la boutique plutôt que sur le domaine de la vitrine.

</Note>

## En connecter un

Le point de départ dépend de ce que le connecteur accepte. Les connecteurs à clé ou à jeton ouvrent un formulaire et prennent le secret directement ; les connecteurs OAuth t’envoient sur l’écran de consentement du fournisseur et reviennent avec un identifiant déjà rempli. Les deux chemins finissent au même endroit — une ligne nommée sous le connecteur.

<Steps>

<Step title="Ouvrir Paramètres > Connectors">

La page est la table des identifiants que ton organisation détient déjà — une ligne par identifiant, avec son nom, son connecteur et sa méthode d’authentification. Dans une organisation neuve, la table est vide ; le catalogue livré attend derrière **Ajouter des identifiants**.

</Step>

<Step title="Choisir le connecteur">

**Ajouter des identifiants** ouvre le catalogue : les connecteurs pour lesquels tu détiens déjà un identifiant viennent en premier, les autres suivent avec leurs catégories et leur nombre d’actions, et la recherche filtre la liste. En choisir un t’amène à l’étape de configuration.

<Frame caption="Ajouter des identifiants s’ouvre sur le catalogue — les treize connecteurs livrés, ceux qui ont déjà un identifiant en premier.">

![La boîte de dialogue Ajouter des identifiants par-dessus la table de Paramètres > Connectors, qui liste les connecteurs livrés sous forme de cartes avec leurs catégories et leur nombre d’actions, un champ de recherche en haut et le connecteur Tavily déjà configuré en tête de liste.](/images/platform/connectors-add-credential.webp)

</Frame>

</Step>

<Step title="Ajouter l’identifiant">

Un connecteur à clé, à jeton ou à couple nom d’utilisateur et mot de passe affiche son formulaire et prend le secret directement. Un connecteur OAuth propose **Connecter** à la place : le consentement du fournisseur se déroule, puis le résultat devient une nouvelle ligne.

</Step>

<Step title="Le nommer et le définir par défaut">

Donne à l’identifiant un nom que tes automatisations pourront viser, et promeus-le s’il doit répondre quand personne n’en nomme un. Les actions du connecteur deviennent disponibles dans les automatisations — et, en lecture, pour les agents de projet — dès que la ligne existe.

</Step>

</Steps>

Le détail par méthode — ce que chaque formulaire demande, comment remplacer un secret, ce qui se passe quand une autorisation expire — vit sur [Identifiants d’connector](/fr/platform/admin/connectors).

## Les actions dans les automatisations et les exécutions d’agent

Chaque action déclarée par un connecteur a un nom, une description, un schéma d’entrée, une signature de sortie et un effet déclaré : `read` ou `write`. Les automatisations posent une action comme nœud dans l’éditeur de workflow ; un agent de projet atteint les actions de lecture depuis sa sandbox par un broker qui les exécute avec l’identifiant stocké et ne renvoie que le résultat. Le chat n’en atteint aucune — les outils de l’assistant de chat sont fixes et en lecture seule. Dans les deux cas l’appel résout d’abord un identifiant — celui que l’appelant nomme, ou celui par défaut du connecteur — et échoue clairement quand il n’y en a ni l’un ni l’autre.

<Warning>

Les actions en écriture changent quelque chose dans l’autre système : un message posté, un ticket ouvert, un SMS envoyé. Elles ne s’exécutent que depuis une automatisation, et elles passent par la politique d’approbation de ton organisation : l’exécution se met en pause et une personne libère l’appel sur la page de détail de l’exécution. Lis [Configurer les approbations](/fr/platform/approvals/configure) avant de lancer une automatisation dessus.

</Warning>

## Quand aucun connecteur ne convient

Treize connecteurs couvrent les systèmes vers lesquels la plupart des équipes se tournent, et ils ne couvrent ni une API interne, ni un outil maison, ni un fournisseur pour lequel personne n’a écrit de connecteur. Enregistrer ton propre serveur MCP pour que les agents l’appellent ne fait pas partie de cette version — ce qui comble l’écart, c’est ton propre code à l’un de deux endroits. Un [agent de projet](/fr/platform/projects/project-agents) porte des **Secrets** — une clé API qu’il reçoit en variable d’environnement — et appelle le service directement depuis sa sandbox. Une [automatisation](/fr/platform/automations/catalog) appelle des actions de connecteur et exécute ton propre JavaScript dans des nœuds `transform`, sur un planning ou un webhook.

La seule surface MCP que Tale livre pointe dans l’autre sens : ton client MCP se connecte à Tale sous **Paramètres > API > MCP**, comme l’explique [Serveurs MCP](/fr/platform/connectors/mcp-servers).

## Où cela s’inscrit

Les connecteurs sont la façon dont Tale atteint les systèmes où ton travail se trouve déjà, et les identifiants sont la décision de savoir au nom de quels comptes il y agit. À partir d’ici, [Identifiants d’connector](/fr/platform/admin/connectors) couvre l’exploitation — ajouter, remplacer, désactiver et reconnecter les lignes sous chaque connecteur. [Agents de projet](/fr/platform/projects/project-agents) montre comment les actions d’un connecteur arrivent dans l’équipement d’un agent, [Configurer les approbations](/fr/platform/approvals/configure) retient celles en écriture, et [Serveurs MCP](/fr/platform/connectors/mcp-servers) dit ce qui a remplacé les serveurs MCP sortants dans cette version.
