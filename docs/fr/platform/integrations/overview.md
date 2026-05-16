---
title: Intégrations — aperçu
description: Connecte Tale à des REST API et bases SQL via des connecteurs nommés et sandboxés.
---

Une intégration est un connecteur défini par un développeur qui expose un système distant comme un ensemble fixe d'opérations nommées que les agents et les automatisations appellent par leur nom avec des paramètres typés. Une fois installées, ces opérations deviennent des outils — sélectionnables dans la liste d'outils d'un agent, invocables depuis une étape **Action** d'une automatisation, soumises à approbation quand elles écrivent. La configuration vit sous **Paramètres > Intégrations** et reste réservée aux rôles Développeur et Admin ; tout le monde voit les outils qui en résultent sans voir le connecteur derrière.

Cette page couvre le modèle d'intégration lui-même — les deux types de connecteurs, les formes d'authentification, la séparation lecture/écriture, les exemples livrés et l'installation. Les connexions apparentées au bas de **Paramètres > Intégrations** (boîtes pour l'inbox, OneDrive pour les imports de connaissance, clés API pour l'API Tale elle-même) sont là pour la découvrabilité mais utilisent leur propre surface de configuration ; elles sont couvertes brièvement à la fin. Le chemin « apporter ton propre catalogue d'outils » via un serveur MCP externe a sa propre page à [Serveurs MCP](/fr/platform/integrations/mcp-servers).

## Les deux types de connecteurs

Les connecteurs viennent en deux formes, chacune adaptée à un type de système distant différent.

Un connecteur **REST API** encapsule n'importe quel service HTTP. Le `config.json` du connecteur déclare les opérations qu'il publie, les méthodes d'authentification qu'il supporte, et une liste d'hôtes autorisés — le code de connecteur sandboxé ne peut joindre que ces hôtes, donc un connecteur défaillant ne peut pas exfiltrer vers un domaine sans rapport. Les méthodes d'authentification supportées sont la clé API (dans un en-tête ou un paramètre d'URL), le `bearer token`, l'auth HTTP basic, et OAuth 2.0 (authorization-code flow avec rotation automatique du jeton de rafraîchissement).

Un connecteur **SQL** se connecte à PostgreSQL, MySQL ou Microsoft SQL Server. L'agent n'écrit jamais de SQL libre. À la place, le connecteur déclare une liste fixe d'opérations nommées, chacune appariant une requête pré-écrite avec un schéma de paramètres ; l'agent choisit une opération et fournit des valeurs validées pour les placeholders. Des credentials en lecture seule restent le bon réflexe — le modèle de connecteur contrôle les requêtes que Tale lancera, mais le compte de base de données lui-même reste entre les mains de ton DBA.

## Opérations

Une opération est l'unité qu'un agent ou une automatisation appelle. Chaque opération a :

- Un **nom** — l'identifiant que l'appelant choisit (`create_order`, `list_customers`, `lookup_reservation`).
- Une **description** — ce que l'opération fait et quand l'utiliser. L'agent la lit pour choisir.
- Un **schéma de paramètres** — un JSON Schema décrivant les entrées. La plateforme valide avant que l'appel ne tourne.
- Un **type d'opération** — `read` ou `write`. Par défaut `read`.
- Un drapeau **requires-approval** — quand il est vrai, chaque invocation génère une carte d'approbation.

Les opérations sont le contrat du connecteur. Un nouveau comportement signifie ajouter (ou modifier) une opération dans `config.json` et livrer le changement ; l'agent ne compose jamais de requêtes HTTP ni de requêtes SQL ad hoc contre le système sous-jacent.

## Lecture, écriture et approbations

Les opérations marquées `write` exigent par défaut une approbation avant exécution. Quand un agent ou une automatisation appelle l'une d'entre elles, la plateforme met l'appel en pause, poste une carte d'approbation dans le chat concerné ou dans l'inbox **Approbations**, et attend une acceptation ou un refus humain. Seule l'acceptation lance l'appel. Les opérations en lecture s'exécutent immédiatement. La doctrine complète — qui peut approuver, à quoi ressemble la carte, ce qu'il se passe au refus — vit à [Approbations](/fr/platform/workspace/approvals) ; utilise-la pour les actions de facturation, les courriels de masse, les écritures en données de production et tout ce qui mérite une seconde paire d'yeux.

## Authentification et secrets

Le tableau `secretBindings` d'un connecteur nomme les credentials qu'il lit à l'exécution via `secrets.get('<key>')`. Quand tu connectes l'intégration sous **Paramètres > Intégrations**, le formulaire demande exactement ces clés ; les valeurs sont stockées chiffrées au repos, scopées à ton organisation, et ne sont jamais retournées à l'UI une fois sauvegardées. Les connecteurs OAuth 2.0 passent par l'authorization-code flow standard, stockent à la fois jeton d'accès et de rafraîchissement, et rafraîchissent le jeton d'accès automatiquement avant son expiration. Les connecteurs SQL stockent serveur, port, base, utilisateur et mot de passe dans le même coffre chiffré.

Le champ **Setup guide** d'un connecteur rend le Markdown fourni par l'auteur dans le manage dialog sous **Guide de configuration** — c'est le bon endroit pour dire à l'utilisateur où générer la clé API, quels scopes OAuth accorder ou quel rôle de base créer. Une fois les credentials saisis, **Tester la connexion** invoque le hook `testConnection` du connecteur avant la sauvegarde ; un échec affiche le message d'erreur en ligne pour corriger les credentials sans quitter le dialogue.

## Exemples livrés

Treize connecteurs prêts à l'emploi sont livrés dans le dépôt sous `examples/integrations/`. Chacun est un `config.json` complet plus le code source du connecteur ; forke-en un comme point de départ pour ta propre variante, ou installe-le tel quel.

| Exemple          | Type     | Auth         | Ce qu'il couvre                                                     |
| ---------------- | -------- | ------------ | ------------------------------------------------------------------- |
| **AI image**     | rest_api | bearer_token | Génération d'images contre des fournisseurs compatibles OpenAI.     |
| **Circuly**      | rest_api | basic_auth   | Produits, clients et abonnements dans Circuly.                      |
| **Discord**      | rest_api | bearer_token | Guildes, salons et messages via la Discord Bot API.                 |
| **GitHub**       | rest_api | bearer_token | Dépôts, issues, `Pull Requests` et recherche de code.               |
| **Gmail**        | rest_api | oauth2       | Messages, labels, threads et brouillons dans Gmail.                 |
| **Google Drive** | rest_api | oauth2       | Synchronise les fichiers de dossiers Drive vers des documents Tale. |
| **Outlook**      | rest_api | oauth2       | Mail, calendrier et contacts via Microsoft Graph.                   |
| **Protel**       | sql      | basic_auth   | Accès SQL direct à un PMS hôtelier Protel — réservations et folios. |
| **Shopify**      | rest_api | api_key      | Produits, clients et commandes dans la Shopify Admin API.           |
| **Slack**        | rest_api | oauth2       | Salons, messages, utilisateurs et uploads de fichiers.              |
| **Tavily**       | rest_api | api_key      | Recherche web ouverte et extraction de pages pour agents LLM.       |
| **Teams**        | rest_api | oauth2       | Équipes, salons, messages et chats via Microsoft Graph.             |
| **Twilio**       | rest_api | basic_auth   | SMS, appels vocaux et gestion des numéros de téléphone.             |

## Installer ou en construire un

Deux chemins déposent un connecteur sur le même `config.json` plus source côté serveur.

**Depuis l'UI.** Ouvre **Paramètres > Intégrations > Ajouter une intégration** et dépose un paquet `.zip` ou sélectionne `config.json`, `connector.ts` (ou `connector.js`) et une icône individuellement. L'upload total est plafonné à 1 Mo. Après l'upload, renseigne les credentials et clique **Tester la connexion**.

**Depuis le code projet.** Un projet créé par `tale init` possède un dossier `integrations/` ; chaque sous-dossier est un connecteur (`integrations/<slug>/{config.json, connector.ts, icon.svg}`). La plateforme recharge à chaud à la sauvegarde, donc itérer revient à éditer n'importe quelle autre source. Le format de fichier et l'API du sandbox sont documentés à [Construire une intégration](/fr/develop/integrations) ; pour l'écriture assistée par IA dans un éditeur, voir [Développement assisté par IA](/fr/develop/ai-assisted-development).

## Serveurs MCP

Au-delà des connecteurs `rest_api` et `sql`, Tale consomme aussi des serveurs Model Context Protocol externes. Un serveur MCP est un processus tiers qui publie son propre catalogue d'outils via un petit RPC standardisé ; Tale enregistre le serveur une fois, et ses outils deviennent disponibles aux agents à côté des opérations de connecteur. La règle mentale : va vers un serveur MCP quand un tiers en publie déjà un pour son produit, et va vers un connecteur quand tu contrôles le wrapper et veux la sémantique lecture/écriture de Tale et l'UX du **Guide de configuration**. La référence complète du flux d'enregistrement, des trois transports supportés et de la sémantique d'approbation sur les outils découverts vit à [Serveurs MCP](/fr/platform/integrations/mcp-servers).

## Connexions apparentées

Trois éléments vivent sous **Paramètres > Intégrations** par souci de découvrabilité mais ne sont pas des connecteurs `rest_api` ou `sql` — chacun a sa propre surface de configuration.

**Boîtes courriel (pour Conversations).** Connecte une boîte IMAP+SMTP pour alimenter l'inbox [Conversations](/fr/platform/workspace/conversations). Les courriels entrants deviennent des fils ; les réponses envoyées depuis la plateforme partent comme des courriels normaux.

**Microsoft OneDrive.** Connecte un compte Microsoft 365 pour que les utilisateurs puissent importer des fichiers OneDrive directement dans la [base de connaissances](/fr/platform/workspace/knowledge-base) sans téléchargement préalable. Configuré via le flux d'import de la base de connaissances, pas comme connecteur.

**Clés API.** Les clés API donnent un accès programmatique à l'API Tale elle-même. Elles vivent sous **Paramètres > Intégrations > Clés API** parce que la surface est le même onglet admin, pas parce que ce sont des connecteurs. Chaque clé hérite du rôle de l'utilisateur qui l'a créée ; révocable à tout moment depuis le même écran. Détails des endpoints dans la [référence API](/fr/develop/api-reference).

## Où cela s'insère

Les intégrations sont le pont entre l'IA de Tale et les systèmes où vivent les vraies données. Un agent sans intégration ne sait que parler ; un agent avec la bonne opération peut créer le ticket, interroger la base, envoyer le courriel, poster le message Slack. Pour accorder à un agent l'accès à une opération précise, la page suivante est [Créer un agent](/fr/platform/agents/create) ; pour le pendant clé API qui laisse _ton_ code appeler Tale au lieu que Tale appelle dehors, ouvre [Référence API](/fr/develop/api-reference).
