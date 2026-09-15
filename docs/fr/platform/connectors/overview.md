---
title: Connecter Tale à des services externes
description: Choisis un connector et le bon compte, puis distingue les contextes où ses lectures et écritures sont autorisées.
---

Utilise un connector lorsque Tale doit lire ou modifier les données d’un service externe. Le connector définit les actions prises en charge. Les identifiants permettent à Tale d’accéder au compte choisi. Les Développeurs, Admins et Propriétaires les gèrent dans **Paramètres > Connectors**.

<Video src="/videos/fr/tutorials/ep7-connectors/ep7-connectors.fr.mp4" poster="/videos/fr/tutorials/ep7-connectors/ep7-connectors.fr.webp" captions="/videos/fr/tutorials/ep7-connectors/ep7-connectors.fr.vtt" lang="fr" title="Épisode 7 — Connectors & le monde extérieur" caption="Épisode 7 — Connectors & le monde extérieur (2:18)">

</Video>

## Choisir la connexion selon la tâche

| Connector | Usage courant | Authentification |
| --- | --- | --- |
| Confluence | Importer des pages Confluence Cloud dans les connaissances. | Nom d’utilisateur avec mot de passe ou jeton. |
| Discord | Travailler avec les messages et canaux. | Jeton. |
| GitHub | Lire ou gérer dépôts, issues et pull requests. | Jeton. |
| Gmail | Lire, envoyer et organiser le courrier. | OAuth. |
| Google Drive | Importer des fichiers dans les connaissances. | OAuth. |
| IMAP / SMTP Mailbox | Lire ou envoyer du courrier via un service privé. | Nom d’utilisateur et mot de passe. |
| Microsoft Outlook | Travailler avec courrier, calendriers et contacts. | OAuth. |
| Shopify | Travailler avec produits, clients et commandes. | Clé API. |
| Slack | Travailler avec les messages et canaux. | OAuth. |
| Tavily | Rechercher sur le web et extraire des pages. | Clé API. |
| Microsoft Teams | Travailler avec les messages et canaux. | OAuth. |
| Twilio | Envoyer des SMS et passer des appels vocaux. | Nom d’utilisateur avec mot de passe ou jeton. |
| WebDAV Files | Lire, écrire et lister les fichiers WebDAV de l’organisation. | Nom d’utilisateur et mot de passe. |

Les cartes du catalogue déployé affichent les actions et méthodes d’authentification actuelles. Ces définitions sont fournies avec la plateforme. Ajouter un compte n’installe pas de code de connector arbitraire.

Les imports de connaissances utilisent l’[indexation des documents](/fr/platform/knowledge/documents). OneDrive et SharePoint passent par l’import dans **Connaissances > Documents**, avec un consentement individuel, plutôt que par un connector d’organisation distinct. Monter les documents Tale sur ton appareil correspond au sens inverse : utilise [WebDAV](/fr/platform/connectors/webdav).

## Ajouter le compte voulu

Choisis **Ajouter des identifiants**, recherche le service et ouvre sa carte. Les connectors déjà configurés apparaissent en premier, mais tu peux ajouter un autre compte pour le même service. Le formulaire demande l’authentification prise en charge.

<Frame caption="Ajouter des identifiants s’ouvre sur le catalogue — les treize connecteurs livrés, ceux qui ont déjà un identifiant en premier.">

![La boîte de dialogue Ajouter des identifiants par-dessus la table de Paramètres > Connectors, qui liste les connecteurs livrés sous forme de cartes avec leurs catégories et leur nombre d’actions, un champ de recherche en haut et le connecteur Tavily déjà configuré en tête de liste.](/images/platform/connectors-add-credential.webp)

</Frame>

Le champ **Nom** est prérempli avec le nom du connecteur. Si tu ajoutes plusieurs comptes pour le même service, remplace-le par un nom qui indique l’usage, par exemple `Boîte support` ou `Bot de publication`. Utilise ceux du service externe, pas une clé API Tale. Pour OAuth, termine le consentement chez le fournisseur et vérifie le compte retourné. Si le parcours ne démarre pas, un administrateur doit peut-être configurer l’app OAuth d’abord.

Confluence et Shopify demandent une **URL de l'instance** pour chaque compte. Utilise l’origine du site Atlassian ou l’adresse `myshopify.com` de la boutique, pas une page quelconque ni le domaine destiné aux clients. [Identifiants des connectors](/fr/platform/admin/connectors) explique les champs, la reconnexion et le renouvellement des secrets.

## Déterminer le compte utilisé

Une action utilise les identifiants explicitement nommés, ou ceux par défaut du connector en l’absence de nom. Un seul compte par connector peut être défini comme compte par défaut. Sans compte par défaut, un appel sans nom échoue même si d’autres identifiants existent.

Deux boîtes support correspondent par exemple à deux lignes. Donne-leur des noms distincts et examine les données résolues du workflow avant une exécution réelle. Le compte par défaut est utilisé lorsque l’action ne nomme pas un autre compte. Les opérations de courrier conçues pour parcourir tous les comptes actifs constituent un cas séparé.

Désactiver des identifiants conserve leur configuration mais empêche leur usage. Remplacer leur secret renouvelle la connexion derrière les références existantes. Vérifie les workflows concernés avant une désactivation, une suppression ou un changement de compte par défaut.

## Distinguer lectures et écritures

Les automatisations utilisent les actions comme nœuds de workflow. Chaque action définit son schéma d’entrée, sa sortie et son effet de lecture ou d’écriture. Les essais simulent les réponses. Lors d’une exécution réelle, une écriture peut envoyer un message ou modifier des données externes et suit la politique d’approbation de l’organisation.

Les agents de projet dont les connectors sont configurés reçoivent les actions de lecture prises en charge via le broker de Tale. Il conserve ces identifiants hors de la sandbox et renvoie les résultats. Il refuse les écritures des connectors. Les outils GitHub directs et les secrets explicitement accordés suivent d’autres voies et demandent une vérification distincte.

Ajouter des identifiants n’ajoute pas librement des outils à l’assistant de chat ordinaire. Utilise les [automatisations](/fr/platform/automations/editor) pour un déroulement défini et les [agents de projet](/fr/platform/projects/project-agents) pour le travail en sandbox.

## Si le service manque

Un agent de projet peut appeler un service depuis sa sandbox si son harness dispose des outils adaptés et d’un secret explicitement accordé. Un nœud `transform` transforme uniquement des données et ne peut pas appeler une API externe. Vérifie les permissions et les effets attendus avant de choisir une intégration directe.

Si l’application externe doit appeler Tale, utilise l’[API REST](/fr/develop/api-reference) ou le [point d’accès MCP](/fr/develop/mcp-endpoint). [MCP et intégrations personnalisées](/fr/platform/connectors/mcp-servers) explique la distinction.
