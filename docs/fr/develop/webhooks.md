---
title: Webhooks
description: Déclencheurs webhook entrants (toi vers Tale) et webhooks d'événement sortants (Tale vers toi). Signature, idempotence, retraitements.
---

Les webhooks sont la manière dont Tale et le reste de ta stack se parlent en asynchrone. Deux directions existent : entrant — ton système POST sur un déclencheur de workflow Tale pour tirer une exécution — et sortant — Tale POST sur ton URL quand quelque chose qui l'intéresse arrive. Les deux moitiés partagent la même politique de retraitement (backoff exponentiel avec jitter) mais s'authentifient différemment : les requêtes entrantes portent leur justificatif comme jeton dans l'URL, les livraisons sortantes sont signées en HMAC-SHA256 sur le body.

Lis ceci quand tu câbles une intégration qui doit réagir à des événements dans une des directions. Reviens-y quand un webhook tire mais que le récepteur ne le voit pas, ou quand les retries ne se comportent pas comme tu l'attendais.

## Un webhook sortant mis en pratique

Quand un événement que Tale surveille survient — une exécution de workflow se termine, un agent finit une réponse, une écriture de document s'achève — Tale POST l'événement sur ton URL configurée :

```http
POST https://your-host.example.com/webhooks/tale
Content-Type: application/json
X-Tale-Event: workflow.execution.completed
X-Tale-Signature: sha256=<hex>
X-Tale-Delivery: <uuid>
X-Tale-Timestamp: 1717000000

{
  "event": "workflow.execution.completed",
  "data": { "workflowId": "...", "executionId": "...", "status": "succeeded", ... }
}
```

Vérifie la signature avant de faire confiance au body : HMAC-SHA256 sur le body brut avec le secret par endpoint, encodé en hex. Compare en temps constant. Rejette toute requête plus vieille que cinq minutes en comparant `X-Tale-Timestamp` à ton horloge.

## Un déclencheur entrant mis en pratique

Quand ton système doit tirer un workflow Tale, POST sur l'URL de webhook que Tale émet quand tu ajoutes un déclencheur webhook au workflow :

```bash
curl -sS https://your-host.example.com/api/automations/webhook/<token> \
  -H "Content-Type: application/json" \
  -d '{ "orderId": "12345", "amount": 199.0 }'
```

Le jeton dans le chemin de l'URL est le justificatif — aucun en-tête Authorization n'est requis ; traite donc l'URL entière comme un secret et supprime le déclencheur pour le révoquer. Le body devient l'entrée de l'exécution ; un body qui n'est pas du JSON est transmis tel quel en texte plutôt que refusé, et tout ce qui dépasse 256 Ko est rejeté en **413**. Un appel accepté renvoie **202** avec `{ "runId": "..." }`. Un jeton inconnu, désactivé ou mal tapé donne un simple **404** — la réponse ne distingue jamais les cas, celui qui devine n'apprend donc rien. Une automatisation sans version déployée répond **409** avec `{ "error": "automation has no deployed version" }` : déploie une version dont les tests passent et le même appel s'exécute.

## Signer et vérifier

Sortant : le secret de signature par endpoint est affiché une fois quand tu ajoutes l'endpoint sous **Paramètres > Intégrations** ou dans le panneau de déclencheur webhook de l'éditeur de workflow. Tale signe chaque body en HMAC-SHA256 avec ce secret ; la vérification est une comparaison de chaînes en temps constant.

Entrant : il n'y a pas de signature — le jeton dans l'URL est l'auth. Si tu ne peux pas garder l'URL secrète, ne la distribue pas ; supprime le webhook pour la faire tourner.

```python
import hmac, hashlib

def verify(body: bytes, signature: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(
        secret.encode(),
        body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)
```

## Idempotence

Entrant : le point de terminaison de déclenchement ne déduplique pas à ta place, un POST retenté lance donc une seconde exécution. Ce qui rend un retry sûr, c'est l'exécution elle-même — une exécution live pose un point de reprise après chaque nœud terminé, une exécution reprise ne rejoue donc jamais les effets de bord déjà produits. Là où une exécution en double resterait fausse, transporte ta propre clé de déduplication dans le payload et branche dessus dans le premier nœud du workflow.

Sortant : chaque livraison porte un UUID `X-Tale-Delivery` unique. Utilise-le pour dédupliquer de ton côté — Tale retraite sur les réponses non-2xx, et le même UUID de livraison apparaîtra à chaque retry jusqu'à ce que le récepteur acquitte.

## Retraitements

Les retraitements sortants suivent un backoff exponentiel avec jitter, plafonnés à 24 heures de tentatives. Le calendrier :

- Retry immédiat sur un 5xx ou un timeout.
- 30 s, 1 m, 5 m, 30 m, 2 h, 8 h, 24 h après le premier échec.
- Après 24 h sans 2xx, la livraison est marquée comme échouée ; le journal d'audit l'enregistre.

Les retraitements entrants sont la responsabilité de l'appelant — la réponse de Tale indique le succès ou l'échec du déclencheur, pas des étapes du workflow. Si tu veux retraiter, utilise une clé d'idempotence stable.

## Où cela s'inscrit

Les webhooks sont la couture entre Tale et les systèmes externes des deux côtés. La [référence API](/fr/develop/api-reference) couvre la moitié synchrone — les endpoints que tu appelles quand tu veux une valeur en retour immédiate. La [référence Déclencheurs](/fr/platform/automations/triggers) couvre le côté workflow des webhooks entrants — la configuration qui transforme un POST en une exécution de workflow.
