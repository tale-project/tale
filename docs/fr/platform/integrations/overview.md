---
title: Intégrations — aperçu
description: Connecte Tale aux REST API, bases SQL, e-mail et stockage cloud.
---

Les intégrations permettent à Tale de parler à des systèmes externes. Les Developers les configurent une fois ; agents, automatisations et chat assistant les utilisent ensuite pour lire et écrire des données dans ces systèmes. La configuration vit sous **Paramètres > Intégrations** et demande le rôle Developer ou plus.

## Types d'intégration

### REST API

Connecte n'importe quelle API HTTP en entrant base URL et credentials. Méthodes d'auth supportées :

| Méthode          | Fonctionnement                                           |
| ---------------- | -------------------------------------------------------- |
| **API key**      | passe une clé dans un header ou un query parameter.      |
| **Bearer token** | header `Authorization: Bearer <token>` à chaque requête. |
| **Basic auth**   | user/password encodés en base64.                         |
| **OAuth 2.0**    | authorization code flow avec refresh automatique.        |

Une fois ajoutée, l'intégration expose chaque endpoint configuré comme outil appelable par l'agent IA. Voir [Créer un agent](/fr/platform/agents/create) pour accorder l'accès.

### SQL

Connecte une base PostgreSQL, MySQL ou Microsoft SQL Server. L'agent IA et les automatisations peuvent l'interroger en langage naturel, traduit en SQL contre le schéma enregistré.

Des credentials en lecture seule sont fortement recommandés — les requêtes générées par l'IA sont exécutées telles quelles.

### E-mail (Conversations)

Connecte une boîte IMAP+SMTP pour alimenter l'inbox [Conversations](/fr/platform/workspace/conversations). Les e-mails entrants deviennent des fils. Les réponses envoyées depuis la plateforme sont livrées comme e-mails normaux.

### Microsoft OneDrive

Connecte un compte Microsoft 365 pour activer la synchro OneDrive. Les utilisateurs peuvent alors importer des fichiers directement depuis OneDrive dans la base de connaissances sans les télécharger. Voir [Base de connaissances](/fr/platform/workspace/knowledge-base).

## Clés API

Génère des clés API pour l'accès programmatique à l'API Tale. Les clés héritent des permissions de l'utilisateur qui les a créées, limitées à son rôle. Révocables à tout moment depuis **Paramètres > Intégrations > API keys**.

Pour les endpoints, voir la [référence API](/fr/develop/api-reference).

## Approbations

Les intégrations peuvent exiger une approbation avant chaque opération. Quand un agent ou une automatisation déclenche un appel, une carte d'approbation apparaît dans le chat — voir [Approbations](/fr/platform/workspace/approvals). Utile pour des opérations destructrices ou coûteuses (facturation, e-mails en masse, changements de données prod).
