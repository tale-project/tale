---
title: Webhooks
description: Déclencheurs webhook entrants — poste sur une URL à jeton et une automatisation déployée s'exécute. Gestion du jeton, rotation, idempotence et codes de réponse.
---

Un webhook permet à un système externe de démarrer une automatisation déployée en envoyant une requête à une URL secrète. Il convient aux événements de commande, formulaires et autres notifications envoyées vers une destination fixe. Une réponse `202` confirme l'acceptation et fournit un ID d'exécution ; elle ne confirme pas la fin du travail.

Pour une première configuration guidée, suis [Déclencher une automatisation par webhook](/fr/tutorials/developer/trigger-automation-via-webhook). Cette référence détaille la livraison, son périmètre, le cycle de vie du jeton et les relances.

## Un déclencheur, de bout en bout

### Préparer une automatisation déployée

Enregistre puis déploie une automatisation dont les tests passent. Lie un webhook dans l'éditeur, ou envoie `PUT /api/v1/automations/{name}/triggers` avec `{"kind":"webhook"}` et une clé API autorisée. Copie immédiatement le nouveau jeton : il n'est renvoyé qu'une fois.

Choisis l'URL selon le périmètre voulu :

| Travail à démarrer | URL | Condition |
| --- | --- | --- |
| Exécution de projet | `/api/projects/{id}/automations/webhook/{token}` | Projet actif dans l'organisation du jeton, avec l'automatisation installée |
| Exécution d'organisation | `/api/automations/webhook/{token}` | Automatisation sans liaison à un projet |

Une automatisation liée à un projet refuse l'URL globale avec `409 AUTOMATION_PROJECT_SCOPE_REQUIRED`. N'ajoute pas de paramètre de requête `projectId` : les deux URL le refusent avec `400 INVALID_QUERY`. Un champ du corps fournisseur reste une donnée d'entrée, pas un sélecteur de projet.

### Envoyer une livraison

Conserve l'URL secrète complète dans `TALE_WEBHOOK_URL` via la configuration sécurisée de l'émetteur. Cette requête utilise un ID stable pour un même événement métier :

```bash
curl --fail-with-body --request POST "$TALE_WEBHOOK_URL" \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: order-12345-paid' \
  --data '{"orderId":"12345","status":"paid"}'
```

L'acceptation renvoie HTTP `202` et une réponse de forme `{"runId":"..."}`. Conserve cet ID avec l'ID de livraison de l'émetteur. Tale transmet le corps à l'automatisation dans cette enveloppe :

```json
{
  "trigger": "webhook",
  "payload": { "orderId": "12345", "status": "paid" }
}
```

Lis la commande via `input.payload.orderId`. Si l'automatisation déclare un schéma `inputs`, il doit décrire cette enveloppe. Un corps qui n'est pas du JSON devient du texte dans `payload`. La limite est de 256 Kio (262 144 octets), comptés pendant la réception ; une requête plus grande reçoit `413`.

### Suivre le résultat

| Périmètre de livraison | Route de suivi authentifiée |
| --- | --- |
| Projet | `GET /api/v1/projects/{id}/runs/{runId}` |
| Organisation | `GET /api/v1/runs/{runId}` |

Interroge la route avec une clé API dont le titulaire peut lire ce périmètre, ou ouvre l'exécution dans Tale. Le jeton webhook autorise les livraisons, pas la lecture des résultats REST. Attends un état terminal avant d'annoncer que le travail a réussi.

### Interpréter les réponses

| Statut | Code/résultat | Action |
| --- | --- | --- |
| `202` | `runId` | Accepté ; suivre l'exécution |
| `202` | `runId`, `duplicate: true` | Déjà accepté ; suivre l'exécution d'origine, aucune nouvelle exécution |
| `400` | `INVALID_QUERY` | Retirer `projectId` de la chaîne de requête |
| `400` | `AUTOMATION_INPUT_INVALID` | Corriger l'enveloppe ou le schéma avec `data.issues` |
| `403` | `AUTOMATION_PROJECT_FORBIDDEN` | Vérifier projet actif, bonne organisation et installation |
| `404` | Jeton inconnu, désactivé ou mal saisi ; aussi toute méthode autre que POST | Vérifier l'URL enregistrée et l'état du déclencheur |
| `409` | `AUTOMATION_NOT_DEPLOYED` | Déployer une version dont les tests passent |
| `409` | `AUTOMATION_PROJECT_SCOPE_REQUIRED` | Utiliser l'URL du projet d'installation |
| `409` | `AUTOMATION_DELIVERY_SCOPE_MISMATCH` | Vérifier le périmètre de l'ID de livraison d'origine |
| `413` | Corps trop volumineux | Réduire les données sous 256 Kio |
| `429` | Budget de l'émetteur ou du déclencheur épuisé | Attendre au moins `Retry-After` |

Une entrée refusée ne crée aucune exécution. Un refus de projet ne distingue volontairement pas un projet absent, archivé ou sans installation, et ne révèle pas le nom de l'automatisation. `GET`, `HEAD` et `OPTIONS` reçoivent le même `404` qu'un jeton invalide, sans en-tête `Allow`.

## Le jeton est l'identifiant

Le secret dans l'URL autorise la livraison. Ce point d'accès ne vérifie pas de signature HMAC du fournisseur et n'utilise pas d'en-tête `Authorization`. Garde l'URL hors des tickets publics, journaux partagés et captures d'écran. Tale stocke son hachage et le compare en temps constant ; le texte en clair n'est fourni qu'à la création.

| Modification | Effet sur le jeton |
| --- | --- |
| `PUT` webhook avec `rotateToken: true` | Nouveau jeton renvoyé une fois ; ancienne URL immédiatement invalide |
| Supprimer/délier le déclencheur | Jeton révoqué ; versions et historique conservés |
| Remplacer le webhook par une planification/un événement | Jeton révoqué ; réponse avec `revoked: "webhook"` |
| Relier ensuite un webhook | Nouveau jeton ; l'ancien ne revient pas |
| Définir `enabled: false` | URL suspendue avec `404`, jeton conservé |
| Réactiver, y compris par un `PUT` ultérieur sans `enabled` | La même URL suspendue redevient active |

<Warning>

Après une fuite, renouvelle le jeton ou délie le déclencheur. Désactiver suspend temporairement l'accès, sans révocation définitive. Coordonne la rotation avec l'émetteur et remplace son URL enregistrée avant de reprendre les livraisons.

</Warning>

Lis `revoked` dans les changements de déclencheur scriptés pour éviter qu'un changement de type coupe discrètement un partenaire qui utilise toujours l'ancienne URL.

## Idempotence et relances

La déduplication porte sur le déclencheur et le projet de son URL. Le même ID de livraison peut démarrer une exécution dans chaque projet d'installation. Tale vérifie encore l'activité du projet et l'installation avant de renvoyer un doublon mémorisé.

| Identité | Fenêtre de doublon | Ce qui doit rester identique |
| --- | --- | --- |
| En-tête d'ID de livraison | 24 heures | Valeur de l'ID et périmètre ; même un corps différent compte comme la même livraison |
| Aucun en-tête d'ID | 2 minutes | Corps identique octet par octet et même URL |

Pour les en-têtes, le premier présent dans cet ordre de priorité l'emporte :

```text
Idempotency-Key
X-Idempotency-Key
webhook-id
X-GitHub-Delivery
X-Gitlab-Event-UUID
X-Shopify-Webhook-Id
Linear-Delivery
X-Atlassian-Webhook-Identifier
X-Request-UUID
I-Twilio-Idempotency-Token
X-Webhook-Id
```

Les noms d'en-têtes sont des alternatives, pas des espaces d'identité séparés. Transmettre l'ID du fournisseur dans `Idempotency-Key` conserve son identité. Sans ID, une mise en forme JSON différente change les octets et peut créer une nouvelle livraison. Préfère un ID d'événement explicite et stable si l'émetteur le permet.

Répéter l'exemple dans les 24 heures renvoie le `runId` d'origine avec `duplicate: true`. Cela ne réexécute pas une automatisation échouée. Décide séparément comment récupérer l'exécution en échec, sans changer aveuglément les IDs de livraison.

Relance les erreurs réseau et les réponses `5xx` temporaires avec une attente exponentielle bornée. Pour `429`, respecte `Retry-After`. Garde l'ID si une réponse a pu être perdue. Corrige les autres causes `4xx` avant de relancer. La déduplication évite les exécutions supplémentaires dans sa fenêtre ; elle ne garantit pas des effets appliqués exactement une fois dans un service externe.

## Budgets

| Budget | Recharge | Rafale | Décompté |
| --- | --- | --- | --- |
| IP de l'émetteur selon les proxys de confiance | 120/minute | 240 | Avant vérification du jeton |
| Déclencheur vérifié | 20/minute | 40 | À l'admission de la livraison |

Chacun peut provoquer `429` avec `Retry-After` en secondes entières et l'enveloppe d'erreur habituelle. Le jeton authentifie l'accès au déclencheur, mais il n'existe pas d'identité de compte émetteur distincte à limiter. Suis les [limites de débit](/fr/develop/rate-limits) et conserve l'ID de livraison pendant l'attente.

## Choisir entre webhook et clé API

Utilise un webhook si l'émetteur accepte une URL d'événement fixe. Choisis une clé API si ton client doit aussi découvrir les automatisations, sélectionner des projets ou lire les résultats. [Déclencheurs](/fr/platform/automations/triggers) explique la configuration dans l'application ; la [référence API](/fr/develop/api-reference) décrit les démarrages authentifiés et leur suivi.
