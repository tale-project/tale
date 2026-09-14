---
title: Vérifier la disponibilité de l’instance
description: Consulte le statut public, surveille sa réponse JSON et distingue une panne d’une opération en échec.
---
Ouvre `/status` sur ton hôte Tale pour vérifier la disponibilité sans te connecter. Les outils de supervision lisent le même résumé sur `/status.json`. Il couvre le backend et les stockages du déploiement, sans garantir chaque modèle ni chaque connexion propre à une organisation.

## Interroger le document de statut

Définis `TALE_BASE_URL` avec l’URL de l’instance, puis demande son statut :

```bash
curl --fail-with-body --silent --show-error \
  "$TALE_BASE_URL/status.json"
```

Examine le contenu JSON, pas seulement le statut HTTP. Lors de la vérification locale avec un stockage objet indisponible, l’endpoint a renvoyé HTTP `200` et ce résultat dégradé :

```json
{
  "status": "degraded",
  "checkedAt": "2026-09-14T04:31:20.847Z",
  "components": [
    { "id": "backend", "status": "operational" },
    { "id": "database", "status": "operational" },
    { "id": "object-store", "status": "outage" }
  ]
}
```

L’application répond et atteint sa base, mais les opérations sur les fichiers demandent une investigation. Une supervision qui considère tout HTTP `200` comme sain manquerait cette panne.

## Interpréter les composantes

| Champ ou composante | Signification |
| --- | --- |
| `status: operational` | Toutes les composantes signalées sont disponibles. |
| `status: degraded` | Certaines sont indisponibles. |
| `status: outage` | Toutes sont indisponibles. |
| `checkedAt` | Heure du contrôle en UTC. |
| `backend` | Accessibilité du backend applicatif. |
| `database` | État combiné de la base applicative et de la base documentaire du déploiement. |
| `object-store` | État du stockage de fichiers du déploiement. |

Les composantes indiquent `operational` ou `outage`. Si le backend ne répond pas, l’état des stockages qui en dépendent ne peut pas être établi ; ils apparaissent aussi indisponibles. Accepte les nouveaux IDs de composantes sans casser ton analyseur.

## Configurer la supervision

Pour un contrôle automatique, installe `jq` et fais porter le verdict par le code de sortie. Cet exemple échoue en cas d’erreur réseau, de JSON invalide ou d’état global différent de `operational` :

```bash
set -o pipefail
curl --fail-with-body --silent --show-error --max-time 10 \
  "$TALE_BASE_URL/status.json" | jq -e '.status == "operational"'
```


L’endpoint JSON ne demande aucune clé API et ne consomme pas son budget. Le résultat reste en cache cinq secondes ; les sondes de stockage se rafraîchissent séparément. Chaque lecture ne déclenche donc pas une nouvelle transaction de contrôle. Définis un délai de requête et alerte sur des échecs répétés ou un état dégradé selon les besoins du service.

`/status.json` autorise les lectures depuis d’autres origines avec `Access-Control-Allow-Origin: *`. `HEAD` renvoie les en-têtes sans corps et `OPTIONS` annonce `GET, HEAD, OPTIONS`. Utilise `GET` pour examiner le verdict des composantes.

## Distinguer réponse du processus et disponibilité réelle

L’endpoint `/api/health` du serveur web de production vérifie le processus à faible coût. Il convient aux sondes de conteneur, mais ne remplace pas les contrôles de dépendances. Le serveur Vite de développement peut router ce chemin autrement et renvoyer `404` ; utilise `/status.json` pour l’application locale.

Un statut sain ne vérifie ni le crédit, ni les droits, ni la disponibilité d’un modèle externe. Il n’exécute pas non plus un téléversement, une recherche, un chat ou une automatisation complets. Ajoute un test contrôlé de bout en bout pour l’opération dont dépend ton intégration.

## Examiner un échec

Pour une composante dégradée, le [dépannage](/fr/self-hosted/operate/observability/troubleshooting) indique les logs concernés. Pour un appel API en échec alors que l’instance est saine, lis le [code d’erreur API](/fr/develop/api-reference). `429` signale une [limite de débit](/fr/develop/rate-limits), pas un verdict de panne de l’instance.

Les instances Cloud exposent les mêmes chemins sur leur propre hôte. Les communications d’incident et documents d’assurance sont décrits dans [Confiance et conformité](/fr/cloud/trust-and-compliance).
