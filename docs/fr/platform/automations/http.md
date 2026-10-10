---
title: Appeler une API depuis une automatisation
description: Lis depuis n’importe quelle API HTTPS ou envoie-lui des données avec les étapes http.get et http.send, avec des identifiants enregistrés ou sans, et sache ce que Tale refuse.
---

Utilise une étape HTTP quand une automatisation a besoin d’une API externe qui n’a pas son propre connector. `http.get` lit, et `http.send` écrit avec POST, PUT, PATCH ou DELETE. Un envoi modifie des données hors de Tale, une exécution en direct demande donc d’abord une [approbation](/fr/platform/approvals/concepts), comme pour toute écriture. Une exécution de test n’envoie jamais rien : elle répond avec un mock.

## Lire depuis une API

```yaml
nodes:
  - id: orders
    type: http.get
    credential: Shop API
    input:
      url: /orders
      query: { status: open }
```

<Frame caption="L’étape dans l’éditeur : les identifiants avec lesquels elle se connecte et son entrée, un chemin sous l’URL de base des identifiants avec des paramètres de requête.">

![L’onglet Editor de Open orders : Start, Orders, Count et End sur le canevas, avec Orders sélectionnée, une étape HTTP · Get. À côté du canevas, ses champs montrent Shop API sous Credential, et sous Input l’url /orders et la query status open. La barre d’outils indique No problems.](/images/platform/automation-http-step.webp)

</Frame>

| Entrée | Ce qu’elle contient |
| --- | --- |
| `url` | Une adresse `https://` complète ou, avec des identifiants, un chemin sous leur URL de base, comme `/orders`. |
| `query` | Des paramètres de requête ajoutés à l’adresse. |
| `headers` | Les en-têtes de la requête. `Authorization`, `Cookie` et l’en-tête de la clé d’API viennent des identifiants, jamais d’ici. |
| `timeoutMs` | Combien de temps attendre la réponse complète : de 1 000 à 30 000 millisecondes, 15 000 par défaut. |
| `responseType` | `json` ou `text`. Sans cette entrée, la réponse est lue en JSON quand son type de contenu est JSON, et comme du texte sinon. |
| `okStatuses` | Des statuts hors de 200–299 qui ne font pas échouer l’étape, comme `[404]`. |

L’étape renvoie `{ status, ok, headers, body }`. `body` contient le JSON analysé ou le texte, et `null` pour une réponse vide. `headers` garde `content-type`, `etag`, `last-modified`, `location`, `link`, `retry-after` et les en-têtes `x-ratelimit-`, et écarte les autres. Un statut hors de 200–299 fait échouer l’étape, sauf si `okStatuses` le cite ; `ok` vaut alors `false`, et une étape suivante décide quoi faire de la réponse.

## Envoyer à une API

`http.send` prend les mêmes entrées et trois de plus : `method` (POST, PUT, PATCH ou DELETE, obligatoire), `body` et `contentType`. Une valeur JSON dans `body` est envoyée en JSON. Une chaîne est envoyée telle quelle, avec `contentType`, ou `text/plain` sans.

```yaml
nodes:
  - id: create_order
    type: http.send
    credential: Shop API
    input:
      url: /orders
      method: POST
      body:
        item: '{{ input.item }}'
        quantity: 2
```

## Se connecter avec des identifiants

Dans **Paramètres › Connectors**, ajoute des identifiants à **HTTP**. Choisis comment ils se connectent : avec un jeton Bearer, une clé d’API envoyée dans un en-tête, ou un nom d’utilisateur et un mot de passe. Saisis leur **Base URL**, comme `https://api.example.com/v2` ; pour une clé d’API, **API key header** nomme l’en-tête, `X-Api-Key` par défaut. Donne un nom aux identifiants, et indique-le dans le champ `credential` de l’étape.

<Frame caption="Des identifiants HTTP avec une clé d’API : le nom par lequel une étape les choisit, la clé, l’URL de base sous laquelle reste chaque appel, et l’en-tête dans lequel la clé est envoyée.">

![La boîte de dialogue Add credential pour HTTP : Authentication method sur API key, Name Shop API, l’API key masquée, Base URL https://api.shop.example/v2, et API key header vide avec X-Api-Key comme indication, au-dessus de Cancel et Add credential.](/images/platform/automation-http-credential.webp)

</Frame>

Une étape avec des identifiants reste sous l’URL de base. Un chemin est placé dessous, une adresse complète doit commencer par elle, et une redirection ne peut pas la quitter. Seuls les identifiants signent la requête. Là où une réponse renverrait une de leurs valeurs, Tale la remplace par `[redacted]`, si bien qu’elle n’atteint jamais l’enregistrement d’une exécution.

Une étape sans identifiants n’en porte aucun, jamais ceux de l’organisation par défaut, et n’appelle que des adresses `https://` publiques.

## Ce que Tale refuse

- Une adresse de réseau privé ou une adresse de métadonnées d’un cloud, avec ou sans identifiants.
- Une adresse `http://` simple. L’éditeur la signale avant l’enregistrement.
- Un nom d’utilisateur ou un mot de passe écrit dans l’adresse, ou des identifiants dans un de ses paramètres de requête : l’éditeur refuse l’enregistrement. Enregistre plutôt les identifiants dans **Paramètres › Connectors**.
- Un en-tête `Authorization` ou `Cookie` défini par l’étape. L’éditeur le refuse aussi.
- Une réponse de plus de 1 Mo.

Les étapes HTTP d’une organisation font au plus 120 appels par minute sur tout le déploiement, et 10 à la fois sur un serveur. Un appel au-delà du budget de la minute échoue ; un appel au-delà du nombre simultané attend une place libre aussi longtemps que son `timeoutMs` le permet.

## Quand une étape échoue

La page de l’exécution dit pourquoi une étape HTTP a échoué et comment corriger le problème. Les [journaux d’exécution](/fr/platform/automations/execution-logs#failures) expliquent comment lire l’échec.

| Échec | Ce qui s’est passé |
| --- | --- |
| **L’API a répondu par une erreur** | Le statut était hors de 200–299, et `okStatuses` ne le cite pas. |
| **L’API a mis trop de temps** | Aucune réponse complète n’est arrivée dans le délai `timeoutMs`. |
| **L’API était injoignable** | Le nom n’a pas été résolu, ou la connexion ou son TLS a échoué. |
| **L’adresse n’est pas autorisée** | L’adresse est privée, une adresse de métadonnées d’un cloud ou en `http://` simple. |
| **L’adresse est hors de celle des identifiants** | Un appel avec des identifiants, ou une de ses redirections, a quitté l’URL de base. |
| **L’adresse ne peut pas être appelée** | L’URL n’est pas une adresse, n’est pas en `https`, est un chemin sans identifiants ou contient un nom d’utilisateur ou un mot de passe. |
| **Un en-tête appartient aux identifiants** | L’étape a défini `Authorization`, `Cookie` ou l’en-tête de la clé d’API. |
| **La réponse est trop volumineuse** | La réponse dépassait 1 Mo. |
| **La réponse n’est pas du JSON** | `responseType` vaut `json`, et la réponse était autre chose. |
| **Trop d’appels d’API à la fois** | Les étapes de l’organisation ont épuisé leur budget d’appels. |
