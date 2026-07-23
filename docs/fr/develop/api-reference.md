---
title: Référence API
description: Comment appeler Tale de l'extérieur — authentification, endpoints, modèle d'erreur, limites de débit et endpoint chat compatible OpenAI. La seule source de vérité pour la surface API de Tale.
i18nLintExclude:
  - terminology-loanword
---

L'API Tale est la surface vers laquelle se tournent les intégrateurs quand ils sont hors du produit et veulent le scripter. L'authentification est une clé API dans un en-tête ; le plan de données est du JSON sur HTTPS ; un sous-ensemble des endpoints chat parle le format Chat Completions d'OpenAI, donc les bibliothèques clientes OpenAI existantes fonctionnent sans changement.

Cette page est l'inventaire canonique de la surface API, du modèle d'auth et de la forme des erreurs. Elle n'énumère pas chaque champ de payload — cela vit à côté de chaque groupe d'endpoints sur les sous-pages liées. Lis-la avant d'appeler l'API ; reviens-y quand tu n'es pas sûr de quel en-tête porte la clé ou de ce que signifie un 429.

## Une requête mise en pratique

La requête utile la plus courte — lister les agents que ta clé peut voir — tient en un curl :

```bash
curl -sS https://your-host.example.com/api/v1/agents \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "Accept: application/json"
```

Une réponse réussie est du JSON : `{ "agents": [ { "id": "...", "name": "...", "visibleInChat": true, ... }, ... ] }`. Chaque endpoint list retourne la même forme — un objet de premier niveau avec une propriété tableau nommée d'après la ressource.

## Authentification

Les clés API sont émises dans l'UI sous **Paramètres > Clés API** par toute personne avec le rôle Développeur ou supérieur. Chaque clé a un nom, un propriétaire et une portée ; la portée suit le rôle de l'utilisateur émetteur au moment de la création. Les clés sont affichées une fois à la création ; Tale n'affiche jamais à nouveau la clé brute.

Passe la clé comme bearer token : `Authorization: Bearer <clé>`. La clé authentifie la requête ; le contexte d'organisation est déduit de la clé. Une clé ne peut pas être utilisée hors de son organisation émettrice.

Les cookies authentifient la session navigateur ; les appels API depuis le navigateur dans le produit utilisent les cookies. Les scripts côté serveur utilisent la clé API.

## Groupes d'endpoints

| Groupe                                                      | Méthode  | Chemin                             | Auth requise | Notes                                                           |
| ----------------------------------------------------------- | -------- | ---------------------------------- | ------------ | --------------------------------------------------------------- |
| Agents                                                      | diverses | `/api/v1/agents/...`               | Clé API      | List, get, run.                                                 |
| Chat                                                        | diverses | `/api/v1/chat/...`                 | Clé API      | Stream de complétions chat contre un agent ou un modèle.        |
| Compatible OpenAI                                           | POST     | `/api/v1/chat/completions`         | Clé API      | Forme Chat Completions OpenAI ; utilise les SDK existants.      |
| Compatible OpenAI                                           | POST     | `/api/v1/images/generations`       | Clé API      | Génère des images ; forme Images OpenAI.                        |
| Compatible OpenAI                                           | GET      | `/api/v1/models`                   | Clé API      | Liste les modèles disponibles au format OpenAI.                 |
| Webhooks d'automatisation                                   | POST     | `/api/automations/webhook/<token>` | Jeton d'URL  | Lancer une exécution de la version déployée depuis l'extérieur. |
| Connaissances — Documents                                   | diverses | `/api/v1/documents/...`            | Clé API      | Upload, list, get, delete.                                      |
| Connaissances — Contacts, Produits, Fournisseurs, Sites web | diverses | `/api/v1/<entity>/...`             | Clé API      | List, get, create, update.                                      |
| Conversations                                               | diverses | `/api/v1/conversations/...`        | Clé API      | List par statut, get, écriture de messages.                     |
| Fichiers                                                    | diverses | `/api/v1/files/...`                | Clé API      | Upload, get, delete. Utilisé par les téléversements.            |

Les formes exactes de champs pour chaque endpoint vivent dans le document OpenAPI que la plateforme émet à la compilation ; charge-le dans une visionneuse Swagger ou Stoplight pour voir les schémas de requêtes et de réponses avec exemples. Les groupes d'endpoints du tableau ci-dessus sont l'inventaire de haut niveau ; le document OpenAPI est la référence au niveau des champs.

## Endpoints compatibles OpenAI

`POST /api/v1/chat/completions` accepte un payload en forme Chat Completions OpenAI et retourne une réponse streaming ou non en même forme. Le champ `model` est interprété comme l'ID d'agent — passe un ID d'agent pour router via les instructions, connaissances et outils de cet agent. Passe un nom de modèle brut (ex. `gpt-4o`) pour contourner les agents et appeler le fournisseur directement.

Les SDK OpenAI existants marchent avec un changement : pointe l'URL de base sur `https://your-host.example.com/api/v1` et substitue la clé API. Le streaming utilise les Server-Sent Events.

### Vision

Pour envoyer une image, donne au message utilisateur un `content` en tableau de parties plutôt qu'une chaîne — une partie `text` plus une ou plusieurs parties `image_url`, chacune portant une URL `data:` ou une URL `https` publique. C'est la forme vision standard d'OpenAI, donc un SDK qui construit déjà des messages multimodaux n'a besoin d'aucun changement. Un `content` en chaîne simple marche toujours pour les tours en texte seul ; seule l'entrée image exige la forme tableau.

### Génération d'images

`POST /api/v1/images/generations` prend `{ model, prompt, n?, response_format? }` et retourne la forme Images OpenAI — `{ created, data: [...] }`. `response_format` vaut `url` (par défaut — chaque entrée est une URL de téléchargement) ou `b64_json` (chaque entrée est des octets d'image en base64) ; `n` est plafonné à 4. Appelle-le via le `images.generate` de n'importe quel SDK OpenAI.

Passer un modèle de génération d'images à `/api/v1/chat/completions` marche aussi : l'image générée revient sur le message assistant sous `choices[0].message.images[]` — chacune une `image_url` — suivant la convention des passerelles capables d'images, de sorte que l'appel est facturé contre une image retournée plutôt que contre une image perdue. Pour éditer une image existante, envoie cette même requête avec une partie `text` et une partie `image_url` portant une URL `data:` à un modèle qui prend en charge l'édition ; l'image éditée revient de la même façon. Seules les URL `data:` sont lues comme entrées d'édition — Tale ne va jamais chercher une URL d'image `http` côté serveur.

## Modèle d'erreur

Les erreurs atterrissent en JSON : `{ "error": { "code": "<symbole>", "message": "<humain>", "details"?: { ... } } }`. Le statut HTTP est l'un de :

- **400** — requête mal formée (champ manquant, mauvais type).
- **401** — clé API manquante ou invalide.
- **403** — la clé est valide mais n'a pas le rôle requis pour l'action.
- **404** — la ressource n'existe pas ou la clé ne peut pas la voir.
- **409** — conflit (ex. clé d'idempotence dupliquée avec un body différent).
- **422** — sémantiquement invalide (ex. l'agent référencé par un déclencheur de workflow a été archivé).
- **429** — limite de débit atteinte. Voir [Limites de débit](/fr/develop/rate-limits).
- **500** — erreur interne. Le champ `details` du body contient un ID de requête citable au support.

Le `code` est un symbole (`unauthorized`, `forbidden`, `agent_not_found`, …) ; le `message` est lisible. Les clients doivent brancher sur `code`, pas sur le message humain.

## Idempotence

Chaque endpoint d'écriture accepte un en-tête `Idempotency-Key`. La première requête avec une clé donnée réussit ; les requêtes suivantes avec la même clé retournent la même réponse sans réexécuter. La clé est valide 24 heures.

Un appel de déclencheur webhook n'est pas dédupliqué à ta place : un POST retenté lance une seconde exécution. Pour celle déjà en vol, la durabilité rend cela sûr — chaque nœud terminé pose un point de reprise, une exécution reprise ne rejoue donc aucun effet de bord. Si une exécution en double reste fausse, transporte ta propre clé dans le payload et branche dessus dans le premier nœud.

## Versionnage

L'API est versionnée par préfixe d'URL : aujourd'hui, `/api/v1/`. Les changements cassants ship sous un nouveau préfixe ; l'ancien reste disponible pendant au moins une version mineure. Les ajouts non cassants atterrissent dans le préfixe courant.

Les notes de version nomment la version d'API contre laquelle chaque release ship ; fige ta bibliothèque cliente sur la version courante en production.

## Où cela s'inscrit

L'API est la couture entre Tale et tout ce qui est dehors. Les webhooks sont l'autre moitié — pour les événements que Tale doit te pousser, ou pour toi à pousser vers les workflows de Tale, la [référence Webhooks](/fr/develop/webhooks) couvre les règles de signature et d'idempotence. Si tu construis dans le produit avec le rôle Développeur — agents, workflows, outils sur mesure — l'[onglet Plateforme](/fr/platform) est ton quotidien ; cette page est pour l'extérieur.
