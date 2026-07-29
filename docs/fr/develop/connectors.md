---
title: Connectors
description: Comment un connecteur est déclaré, ce qu’une de ses actions promet à l’appelant, et quand héberger un serveur MCP à la place.
---

Les connecteurs sont la moitié propre aux fournisseurs de la façon dont Tale atteint d’autres systèmes, et ils font partie de la plateforme plutôt que d’un assemblage à la charge d’une organisation. Chacun est un fichier YAML dans l’arbre des sources qui déclare à qui il parle, comment il s’authentifie et chaque action qu’il sait exécuter — d’où un catalogue identique dans tous les déploiements, qu’une mise à jour suffit à faire avancer. Lis cette page pour savoir ce qu’un connecteur promet réellement à un appelant, ou quand tu hésites entre contribuer un connecteur et héberger un serveur MCP.

Le versant organisation — ajouter des identifiants, choisir celui par défaut, relancer une autorisation expirée — est [Identifiants d’connector](/fr/platform/admin/connectors), et le catalogue lui-même est [Connectors](/fr/platform/connectors/overview).

## Comment un connecteur est déclaré

Chaque connecteur est un répertoire sous `configs/platform/system/connectors/`, nommé d’après son slug, contenant un `connector.yml` et l’icône que la page de paramètres affiche. Le slug est à la fois le nom du répertoire, le `name` déclaré du connecteur et la première moitié du type de nœud avec lequel une automatisation pose une de ses actions — `<connector>.<action>`. Treize de ces répertoires sont livrés aujourd’hui.

Le fichier s’ouvre sur l’identité du connecteur et son contrat d’authentification, puis énumère les actions :

```yaml
name: tavily
displayName: Tavily
description: Real-time web search and page extraction for AI research.
tags:
  - Search
allowedHosts:
  - api.tavily.com
auth:
  - method: api-key
actions:
  - name: search
    description: >-
      Search the open web via Tavily. Returns top results with title, URL,
      content snippet, and score.
    effects: read
    input:
      type: object
      required: [query]
      properties:
        query: { type: string, description: 'Natural-language search query.' }
        max_results: { type: number, description: 'Max results (1-10).' }
    output: '{ answer?: string, results: Array<{ title: string, url: string, content: string, score: number }> }'
```

`allowedHosts` est la frontière de sortie — un corps d’action qui viserait ailleurs est refusé plutôt que relayé. Un connecteur dont l’API vit chez le client plutôt que chez le fournisseur ajoute `endpointMode: per-credential`, et chaque identifiant porte alors l’origine à partir de laquelle ses appels sont construits ; Confluence et Shopify sont les deux cas livrés.

<Info>

Les connecteurs sont lus dans l’arbre de la plateforme, pas dans la configuration d’une organisation, et aucun chemin de téléversement n’en ajoute à l’exécution. Ajouter un connecteur est une contribution au code source — voir [Configuration du contributeur](/fr/develop/contributor-setup). Héberger ton propre pont sans toucher aux sources, c’est précisément ce à quoi sert MCP.

</Info>

## Ce qu’une action déclare

Une action est un contrat, et chacun de ses champs est visible pour l’appelant avant que l’appel n’ait lieu :

- **Nom et description.** Le nom complète le type de nœud ; la description est ce que lit un agent quand il décide si cette action est la bonne.
- **Entrée.** Un JSON Schema — type objet, champs obligatoires et une description par propriété. Les automatisations valident la configuration d’un nœud contre lui, et les agents la remplissent à partir du même schéma.
- **Sortie.** Une signature décrivant la forme qui revient, pour que l’auteur d’un workflow sache ce que l’étape suivante peut référencer.
- **Effets.** Soit `read`, soit `write`. Les actions en écriture passent par la politique d’approbation de l’organisation, et un appel qui n’atteint aucune décision d’approbation est refusé plutôt qu’exécuté sans contrôle.

Les actions résolvent leur identifiant au moment de l’appel : celui que l’appelant nomme, ou celui par défaut du connecteur quand il n’en nomme aucun. C’est cette couture qui permet à la même automatisation de tourner sur un autre compte en la pointant vers un autre nom d’identifiant.

## Les méthodes d’authentification

Un connecteur déclare les méthodes qu’il accepte, et un identifiant est enregistré sous exactement l’une d’elles. Les quatre sont fixes, parce que chacune décrit un chemin différent par lequel un secret atteint le fournisseur.

| Méthode   | Libellé dans l’interface          | Ce que porte l’identifiant                                                                                                     |
| --------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `api-key` | Clé API                           | Un secret unique que le corps de l’action place lui-même — un en-tête du fournisseur, un paramètre d’URL ou un champ du corps. |
| `bearer`  | Jeton                             | Un jeton envoyé dans l’en-tête Authorization, sous le schéma que le connecteur nomme.                                          |
| `basic`   | Nom d’utilisateur et mot de passe | Un nom d’utilisateur et un mot de passe en HTTP Basic, la forme que prend aussi un login de boîte mail.                        |
| `oauth2`  | OAuth                             | Une autorisation par code : jeton d’accès, jeton de rafraîchissement, expiration et portées accordées.                         |

Les secrets sont chiffrés au repos dans une seule enveloppe et ne ressortent jamais vers un appelant. Une liste affiche un aperçu masqué calculé à l’écriture de l’identifiant, si bien que lire la liste ne touche jamais au chiffré.

## Enregistrer une application OAuth

Un connecteur `oauth2` déclare les URL d’autorisation et de jeton du fournisseur ainsi que les portées qu’il demande, et le déploiement fournit l’application contre laquelle ces URL s’authentifient. Enregistre exactement ce callback comme URI de redirection autorisée côté fournisseur, construit à partir du `SITE_URL` du déploiement et de son éventuel préfixe `BASE_PATH` :

```text
${SITE_URL}${BASE_PATH}/api/connectors/oauth2/callback
```

L’identifiant client et le secret de chaque connecteur viennent de l’environnement du déploiement, nommés par connecteur `CONNECTOR_OAUTH_<SLUG>_CLIENT_ID` et `CONNECTOR_OAUTH_<SLUG>_CLIENT_SECRET`, le slug en majuscules et ses tirets changés en tirets bas. Quand `SITE_URL` n’est pas défini, le consentement refuse de démarrer au lieu de deviner une origine à partir de la requête.

<Warning>

L’URI de redirection doit correspondre octet pour octet — schéma, hôte, chemin, et pas de barre oblique finale. Un écart échoue dès l’écran de consentement du fournisseur avec une erreur `redirect_uri`, avant même que Tale ne voie le callback ; c’est de loin la raison la plus fréquente pour laquelle un nouveau connecteur OAuth ne se connecte pas.

</Warning>

## Choisir une surface

Deux surfaces atteignent des systèmes hors de Tale, et le choix porte sur qui possède le pont et qui le fait tourner.

| Surface         | Prends-la quand                                                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connector livré | Un connecteur existe déjà pour le système visé. Ton travail se limite aux identifiants, et le contrat fournisseur est maintenu pour toi.           |
| Serveur MCP     | Rien de livré ne couvre le système — une API interne, un outil maison, un hôte que seul ton réseau atteint. Tu écris et fais tourner le processus. |

Un serveur MCP s’enregistre sous **Paramètres > API > MCP**, et chaque outil qu’il expose rejoint la trousse de l’agent aux côtés des actions de connecteur, avec son propre drapeau d’approbation. La référence est [Serveurs MCP](/fr/platform/connectors/mcp-servers) ; la construction de bout en bout est [Monter un serveur MCP de zéro](/fr/tutorials/developer/mcp-server-from-scratch).

## Où cela s’inscrit

Un connecteur est un contrat déclaré — hôtes, authentification et une liste d’actions typées — livré avec la plateforme et alimenté par des identifiants qui appartiennent à l’organisation. Lis [Connectors](/fr/platform/connectors/overview) pour ce que contient le catalogue, [Identifiants d’connector](/fr/platform/admin/connectors) pour la gestion quotidienne de ces identifiants, et [Serveurs MCP](/fr/platform/connectors/mcp-servers) quand le pont dont tu as besoin doit être ton propre code.
</content>
</invoke>
