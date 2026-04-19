---
title: Webhooks
description: Lance workflows et agents depuis des systèmes externes via des requêtes HTTP signées.
---

Tale expose deux types de webhooks : **webhooks de workflow** (déclenchent une automatisation) et **webhooks d'agent** (envoient un message à un agent hors de l'UI chat). Les deux utilisent le même format de requête et schéma de signature.

## Webhooks de workflow

Chaque workflow a une URL webhook unique visible dans son onglet Configuration :

```text
https://<your-tale-domain>/api/webhooks/workflow/<workflow-id>
```

POST un body JSON pour démarrer le workflow avec ces données en entrée :

```bash
curl -X POST https://tale.example.com/api/webhooks/workflow/abc123 \
  -H "Content-Type: application/json" \
  -H "X-Tale-Signature: sha256=..." \
  -d '{"customerId": "c-42", "priority": "high"}'
```

La réponse arrive immédiatement avec un ID d'execution. Consulte l'onglet Executions du workflow (ou l'API REST) pour voir statut et sortie.

## Webhooks d'agent

Chaque agent a un endpoint unique :

```text
https://<your-tale-domain>/api/webhooks/agent/<agent-slug>
```

POST un message pour obtenir une réponse d'agent sans utiliser l'UI. La réponse est synchrone — la requête HTTP bloque jusqu'à ce que l'agent ait fini de générer.

```bash
curl -X POST https://tale.example.com/api/webhooks/agent/support-agent \
  -H "Content-Type: application/json" \
  -H "X-Tale-Signature: sha256=..." \
  -d '{
    "message": "Où est ma commande ?",
    "conversationId": "optional-existing-id"
  }'
```

Si `conversationId` est omis, une nouvelle conversation est créée et renvoyée.

## Vérification de signature

Tale signe chaque requête webhook en HMAC-SHA-256 avec le secret du webhook. La signature est envoyée dans l'en-tête `X-Tale-Signature` au format `sha256=<hex>`.

Les récepteurs doivent :

1. lire le body brut (pas le JSON parsé) ;
2. calculer `HMAC-SHA-256(secret, body)` ;
3. comparer avec la valeur de l'en-tête en comparaison temps-constant ;
4. rejeter les requêtes qui ne matchent pas.

Exemple Node.js :

```javascript
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(req, secret) {
  const signature = req.headers['x-tale-signature'];
  if (!signature) return false;
  const expected =
    'sha256=' + createHmac('sha256', secret).update(req.rawBody).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

Exemple Python :

```python
import hmac, hashlib

def verify(body: bytes, header: str, secret: str) -> bool:
    expected = 'sha256=' + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(header or '', expected)
```

## Nouvelles tentatives

Tale retente les livraisons webhook échouées (réponses non-2xx, timeouts) avec backoff exponentiel jusqu'à 5 tentatives. Après l'échec final, la livraison est marquée en échec et loggée dans le flux d'audit — un admin peut la rejouer depuis la page Audit logs.

## Voir aussi

- [Référence API](/fr/develop/api-reference) pour l'API REST complète.
- [Triggers](/fr/build/automations/triggers) pour configurer des triggers webhook sur les workflows.
- [Agents — onglet Webhook](/fr/build/agents/create#onglet-webhook) pour la mise en place des webhooks d'agent.
