---
title: Webhooks
description: Invoquer workflows et agents depuis des systèmes externes via des endpoints HTTP à jeton unique.
---

Tale expose deux surfaces de webhook entrantes : **webhooks de workflow** (un POST externe lance une exécution de workflow) et **webhooks d'agent** (un POST externe envoie un message à un agent et reçoit la réponse). Les deux utilisent une URL à jeton unique où le jeton est l'identifiant — pas de signature HMAC séparée, pas de secret partagé à faire tourner, pas de code de signature à écrire côté appelant. Cette page est la référence de fil pour les deux surfaces ; pour le parcours détaillé end-to-end, [Déclencher une automatisation via webhook](/fr/tutorials/developer/trigger-automation-via-webhook) couvre le côté workflow.

Le public, ce sont les intégrateurs qui branchent un système externe sur Tale. Le pendant — l'API sortante de Tale, ce que ton code appelle — vit sous [Référence API](/fr/develop/api-reference).

## Exemple travaillé — déclencher un webhook de workflow

Le déclencheur de workflow le plus petit possible depuis cURL :

```bash
curl -X POST "https://your-tale-instance.com/api/workflows/wh/<TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"customerId":"c-42","priority":"high","lines":3}'
```

La réponse revient immédiatement, avant que le workflow tourne :

```json
{ "status": "accepted", "workflowSlug": "incoming-order-intake" }
```

Le workflow tourne de manière asynchrone ; l'appelant ne bloque jamais en attendant la sortie. Les statuts et résultats par étape vivent dans l'onglet **Exécutions** du workflow — voir [Journaux d'exécution](/fr/platform/automations/execution-logs).

## Webhooks de workflow

Chaque workflow avec un déclencheur webhook a une URL unique de la forme :

```text
https://<ton-instance-tale>/api/workflows/wh/<TOKEN>
```

Le jeton fait 64 caractères hexadécimaux et est généré quand tu ajoutes le déclencheur dans **Automatisations > <workflow> > Déclencheurs**. C'est le seul identifiant — quiconque détient l'URL peut poster des événements vers le workflow.

### POST /api/workflows/wh/{token}

Lance une exécution de workflow. Le corps du POST devient l'entrée du workflow, adressable comme `{{ trigger.body }}` dans chaque étape.

| Nom                 | Type   | Obligatoire | Description                                                                                                                              |
| ------------------- | ------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Type`      | string | Oui         | `application/json`. Les autres content-types sont rejetés.                                                                               |
| `X-Idempotency-Key` | string | Non         | Identifiant stable pour des relances sûres. Les livraisons en double renvoient l'exécution originale au lieu d'en démarrer une nouvelle. |
| _corps de requête_  | object | Oui         | JSON arbitraire. Tout le corps est passé en entrée au workflow.                                                                          |

**Réponse — première livraison :**

```json
{ "status": "accepted", "workflowSlug": "<workflow-slug>" }
```

**Réponse — livraison en double (même `X-Idempotency-Key`) :**

```json
{ "status": "duplicate", "executionId": "<id>" }
```

Le chemin de doublon renvoie l'ID de l'exécution originale pour que l'appelant puisse consulter l'exécution existante au lieu de deviner si la relance a pris.

### Codes de statut

| Code | Signification                                                            |
| ---- | ------------------------------------------------------------------------ |
| 200  | Accepté (ou doublon). Le corps distingue les deux cas.                   |
| 400  | Charge utile JSON invalide, jeton manquant, ou format de jeton invalide. |
| 403  | Webhook désactivé, ou workflow non publié / non installé.                |
| 404  | Le jeton ne correspond à aucun webhook.                                  |
| 429  | Limite de taux par IP dépassée.                                          |

## Webhooks d'agent

Chaque agent avec un webhook actif a une URL unique :

```text
https://<ton-instance-tale>/api/agents/wh/<TOKEN>
```

Les jetons suivent le même format de 64 caractères hexadécimaux que les jetons de workflow ; crée-les ou révoque-les dans l'onglet **Webhook** de l'agent. L'endpoint expose deux formats de fil — une forme native Tale (legacy) et un sous-chemin OpenAI-compatible — pour qu'un client OpenAI existant puisse adresser un agent sans réécrire la requête.

### POST /api/agents/wh/{token} — forme native Tale

Envoie un message utilisateur unique à l'agent. La réponse interroge jusqu'à ce que l'agent ait terminé la génération, ou diffuse des Server-Sent Events quand `stream: true`.

| Nom        | Type    | Obligatoire | Description                                                                  |
| ---------- | ------- | ----------- | ---------------------------------------------------------------------------- |
| `message`  | string  | Oui         | Le message utilisateur. Texte brut.                                          |
| `threadId` | string  | Non         | Réutiliser un fil de conversation existant. Un nouveau fil est créé si omis. |
| `stream`   | boolean | Non         | Diffuser la réponse en SSE. Défaut `false`.                                  |

Le corps peut aussi être envoyé en `multipart/form-data` pour joindre un fichier à côté du message — les champs sont `message`, `threadId`, `stream` et `file`.

**Réponse — sans streaming :**

```json
{
  "threadId": "<id>",
  "message": "<la réponse de l'agent>",
  "status": "done"
}
```

### POST /api/agents/wh/{token}/chat/completions — OpenAI-compatible

Le même agent est adressable comme endpoint Chat Completions OpenAI. Le sous-chemin laisse n'importe quel client OpenAI parler à l'agent sans réécriture :

```bash
curl -X POST "https://<ton-instance-tale>/api/agents/wh/<TOKEN>/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o",
    "messages": [{"role": "user", "content": "Bonjour !"}]
  }'
```

Le champ `model` est optionnel — quand présent, Tale le valide contre les `supportedModels` de l'agent et retombe silencieusement sur le défaut de l'agent quand le modèle demandé n'est pas autorisé. La forme de réponse correspond à `/v1/chat/completions` d'OpenAI.

### Codes de statut (les deux formes)

| Code | Signification                                                                                |
| ---- | -------------------------------------------------------------------------------------------- |
| 200  | Réponse livrée.                                                                              |
| 400  | Corps invalide (`message` manquant, JSON mal formé, tableau messages vide).                  |
| 401  | Jeton webhook invalide.                                                                      |
| 403  | Webhook désactivé.                                                                           |
| 404  | Le jeton ne correspond à aucun webhook d'agent.                                              |
| 429  | Limite de taux par IP dépassée.                                                              |
| 413  | Texte `system` client concaténé dépassant 50 000 caractères (sous-chemin OpenAI uniquement). |
| 504  | La réponse a fini en timeout (l'agent n'a pas terminé dans la limite stricte de 9 minutes).  |

## Rotation des jetons

Il n'y a pas de secret de signature à faire tourner — l'identifiant est le jeton lui-même. Pour faire tourner :

1. Ouvre le panneau **Déclencheurs** du workflow ou l'onglet **Webhook** de l'agent.
2. Clique **Régénérer**. Tale frappe un nouveau jeton ; l'ancien arrête d'accepter les requêtes immédiatement.
3. Mets à jour l'URL stockée de l'appelant vers le nouveau jeton.

Il n'y a pas de fenêtre de chevauchement : la régénération est instantanée, donc les mises à jour côté appelant doivent atterrir dans la même fenêtre de changement. Pour les flux de rotation automatisés, traite la rotation du jeton comme une rotation de clé API — garde les deux URL valides brièvement en ajoutant un second déclencheur avant de retirer l'ancien.

## Relances et idempotence

Pour les **webhooks de workflow**, l'appelant est responsable des relances. Tale ne relance pas le POST entrant lui-même — les relances par étape internes au workflow gèrent les échecs internes, mais une réponse HTTP non-2xx est la responsabilité de l'appelant. Utilise `X-Idempotency-Key` pour rendre les relances côté appelant sûres.

Pour les **webhooks d'agent**, la requête est synchrone — l'appelant attend la réponse de l'agent — et une relance répète l'appel au modèle. Mets un timeout côté client raisonnable (assez long pour un modèle lent, assez court pour que les connexions pendues ne s'empilent pas) et évite de relancer sur des réponses `200`.

## Limite de confiance

Ce qui traverse le réseau dans chaque direction :

- **De l'appelant vers Tale** : le corps du POST et les en-têtes, y compris le jeton dans l'URL. HTTPS protège tout en transit ; le jeton n'est pas envoyé comme en-tête, donc il reste hors des lignes de log `Authorization` standard, mais il apparaît dans l'URL de tout journal d'accès que l'appelant écrit. Traite-le en conséquence.
- **De Tale vers l'appelant** : le corps de la réponse. Les webhooks d'agent renvoient la réponse complète du modèle ; les webhooks de workflow ne renvoient que `accepted` / `duplicate` plus le slug du workflow ou l'ID d'exécution — pas la sortie du workflow.
- **Ce que Tale fait de la charge utile** : le corps JSON atterrit dans le journal d'exécution du workflow ou l'historique de conversation de l'agent, régi par les politiques de rétention et d'audit de ton organisation. Pas de persistance externe séparée.

## Où ça s'inscrit

Les webhooks sont le pendant entrant de l'API sortante de Tale. L'API est ce que ton code appelle quand tu pilotes la conversation ; les webhooks sont ce que Tale expose pour qu'un système externe puisse piloter un workflow ou adresser un agent sans être assis dans l'UI de chat. Les deux surfaces partagent le même journal d'audit, donc une seule configuration d'observabilité couvre tout ce que Tale reçoit.

Pour les pièces liées : [Référence API](/fr/develop/api-reference) est le côté sortant de la même famille de protocole, [Déclencheurs](/fr/platform/automations/triggers) couvre comment un workflow opte pour un déclencheur webhook, et l'[onglet Webhook d'un agent](/fr/platform/agents/create#webhook-tab) déroule la configuration par agent.
