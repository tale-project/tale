---
title: Intégrations — aperçu
description: Connecte Tale à des REST API et bases SQL via des connecteurs développés sur mesure.
---

Une intégration est un connecteur défini par un développeur qui expose les capacités d’un système distant — endpoints REST ou requêtes SQL — comme une liste fixe d’opérations nommées. Une fois installées, ces opérations deviennent des outils que le chat assistant, les agents et les étapes d’action des automatisations appellent par leur nom avec des paramètres typés. La configuration vit sous **Paramètres > Intégrations** et demande au minimum le rôle Développeur ; les consommateurs appellent simplement les opérations que le connecteur publie.

La plateforme prend en charge deux types de connecteurs : `rest_api` pour les services HTTP et `sql` pour l’accès direct à une base de données. Tout le reste qui apparaît sous **Paramètres > Intégrations** dans l’UI — boîtes email, Microsoft OneDrive, clés API de l’API Tale elle-même — sont des connexions apparentées avec leur propre surface de configuration, pas le modèle connecteur. Elles sont couvertes en bas de cette page.

## Types d’intégration

### REST API

Les connecteurs REST encapsulent n’importe quel service HTTP. Le manifeste du connecteur liste les méthodes d’authentification supportées et les hôtes qu’il peut joindre ; du code de connecteur sandboxé gère chaque opération. Méthodes d’authentification supportées :

| Méthode          | Fonctionnement                                               |
| ---------------- | ------------------------------------------------------------ |
| **API key**      | Passe une clé dans un header ou un query parameter.          |
| **Bearer token** | Header `Authorization: Bearer <token>` à chaque requête.     |
| **Basic auth**   | Utilisateur et mot de passe encodés en base64.               |
| **OAuth 2.0**    | Authorization-code flow avec rafraîchissement de jeton auto. |

Le champ `allowedHosts` du manifeste agit comme une allow-list réseau — le connecteur ne peut joindre que les hôtes qu’il déclare. Voir [Créer un agent](/fr/platform/agents/create) pour accorder à un agent l’accès aux opérations d’une intégration.

### SQL

Les connecteurs SQL se branchent sur PostgreSQL, MySQL ou Microsoft SQL Server. L’agent **n’écrit pas** de SQL libre. Le manifeste de l’intégration enregistre une liste fixe d’opérations nommées, chacune avec une requête pré-écrite et un schéma de paramètres ; l’agent choisit une opération et fournit des valeurs pour les placeholders. Des credentials en lecture seule restent fortement recommandés — les opérations en écriture et les portes d’approbation ne contraignent que ce que le connecteur publie, pas ce que le compte de base de données est lui-même autorisé à faire.

## Opérations

Chaque intégration publie une liste d’opérations. Une opération a un `name` (l’identifiant que l’agent appelle), une `description` (ce qu’elle fait et quand l’utiliser), un `parametersSchema` (un JSON Schema décrivant les entrées), un `operationType` optionnel (`read` ou `write`) et un drapeau `requiresApproval` optionnel. L’agent choisit une opération par son nom et fournit des paramètres validés ; il ne compose jamais d’appels HTTP ad hoc ni de SQL libre. C’est ce qui rend un connecteur prévisible : une nouvelle opération n’existe que si un développeur l’ajoute au manifeste.

## Lecture, écriture et approbations

Les opérations marquées `operationType: write` exigent par défaut une approbation avant exécution. Quand un agent ou une automatisation déclenche une telle opération, une carte d’approbation apparaît dans le chat — un humain accepte ou refuse, et seule l’acceptation lance l’appel. Voir [Approbations](/fr/platform/workspace/approvals) pour le flux complet. Utile pour la facturation, les Emails de masse, l’écriture en données de production, et tout ce où tu veux un humain dans la boucle. Les opérations en lecture s’exécutent directement, sans étape d’approbation.

## Authentification et secrets

Le tableau `secretBindings` du manifeste nomme les clés de credentials qu’un connecteur lit à l’exécution via `secrets.get('<key>')`. Quand tu connectes l’intégration sous **Paramètres > Intégrations**, l’UI demande exactement ces clés et stocke les valeurs chiffrées au repos, dans le périmètre de ton organisation. Les connecteurs OAuth 2.0 utilisent l’authorization-code flow standard, stockent jeton d’accès et de rafraîchissement, et rafraîchissent les jetons d’accès automatiquement à expiration. Les connecteurs SQL stockent serveur, port, nom de base, utilisateur et mot de passe dans le même coffre chiffré.

## Guide de configuration et test de connexion

Les connecteurs peuvent livrer un `setupGuide` Markdown que la plateforme rend sous **Guide de configuration** dans le manage dialog — utilise-le pour pointer vers où générer la clé API, quels scopes OAuth accorder, ou quel rôle de base créer. Une fois les credentials saisis, **Tester la connexion** invoque le hook `testConnection` léger du connecteur avant de sauvegarder ; un échec affiche le message d’erreur du connecteur en ligne, sans quitter le dialogue.

## Exemples livrés

Le dépôt fournit treize connecteurs prêts à l’emploi à [github.com/tale-project/tale/tree/main/examples/integrations](https://github.com/tale-project/tale/tree/main/examples/integrations). Forke-en un comme point de départ pour un connecteur sur mesure contre le même fournisseur, ou installe-en un tel quel.

| Exemple          | Type     | Auth         | Ce qu’il couvre                                                     |
| ---------------- | -------- | ------------ | ------------------------------------------------------------------- |
| **AI image**     | rest_api | bearer_token | Génération d’images contre des fournisseurs compatibles OpenAI.     |
| **Circuly**      | rest_api | basic_auth   | Produits, clients et abonnements dans Circuly.                      |
| **Discord**      | rest_api | bearer_token | Guildes, salons et messages via la Discord Bot API.                 |
| **GitHub**       | rest_api | bearer_token | Dépôts, issues, pull requests et recherche de code.                 |
| **Gmail**        | rest_api | oauth2       | Messages, labels, threads et brouillons dans Gmail.                 |
| **Google Drive** | rest_api | oauth2       | Synchronise les fichiers de dossiers Drive vers des documents Tale. |
| **Outlook**      | rest_api | oauth2       | Mail, calendrier et contacts via Microsoft Graph.                   |
| **Protel**       | sql      | basic_auth   | Accès SQL direct à un PMS hôtelier Protel — réservations et folios. |
| **Shopify**      | rest_api | api_key      | Produits, clients et commandes dans la Shopify Admin API.           |
| **Slack**        | rest_api | oauth2       | Salons, messages, utilisateurs et uploads de fichiers.              |
| **Tavily**       | rest_api | api_key      | Recherche web ouverte et extraction de pages pour agents LLM.       |
| **Teams**        | rest_api | oauth2       | Équipes, salons, messages et chats via Microsoft Graph.             |
| **Twilio**       | rest_api | basic_auth   | SMS, appels vocaux et gestion des numéros de téléphone.             |

## Installer ou construire une intégration sur mesure

Il y a deux façons d’installer un connecteur. Les deux finissent avec le même `config.json` plus le code du connecteur sur le serveur.

**Téléverser depuis l’UI.** Ouvre **Paramètres > Intégrations**, clique **Ajouter une intégration**, puis dépose un paquet `.zip` ou choisis `config.json`, le code du connecteur (`connector.ts` ou `connector.js`) et une icône individuellement. Le total est plafonné à 1 Mo. Après l’upload, renseigne les credentials et clique **Tester la connexion**.

**Écrire comme code de projet.** Un projet créé par `tale init` possède un dossier `integrations/` ; chaque sous-dossier est un connecteur (`integrations/<slug>/{config.json, connector.ts, icon.svg}`). La plateforme recharge à chaud à la sauvegarde, donc itérer revient à éditer n’importe quelle source. Le format de fichier complet et l’API du sandbox sont documentés dans [Construire une intégration](/fr/develop/integrations) ; pour l’écriture assistée par IA dans l’éditeur, voir [Développement assisté par IA](/fr/develop/ai-assisted-development).

## Connexions apparentées

Quelques autres éléments vivent sous **Paramètres > Intégrations** par souci de découvrabilité, mais ne sont pas des connecteurs `rest_api` ou `sql` — ils ont leur propre surface de configuration.

**Email (boîte Conversations).** Connecte une boîte IMAP+SMTP pour alimenter l’inbox [Conversations](/fr/platform/workspace/conversations). Les Emails entrants deviennent des fils ; les réponses envoyées depuis la plateforme partent comme des Emails normaux. Configuré séparément des connecteurs.

**Microsoft OneDrive.** Connecte un compte Microsoft 365 pour permettre aux utilisateurs d’importer des fichiers OneDrive directement dans la [base de connaissances](/fr/platform/workspace/knowledge-base) sans téléchargement préalable. Configuré via le flux d’import de la base de connaissances, pas comme connecteur.

## Clés API

Les clés API donnent un accès programmatique à l’API Tale elle-même. Elles vivent sous **Paramètres > Intégrations > Clés API** parce que c’est la même surface admin, pas parce qu’elles sont des connecteurs. Chaque clé hérite du rôle de l’utilisateur qui l’a créée ; révocable à tout moment depuis le même écran. Détails des endpoints dans la [référence API](/fr/develop/api-reference).
