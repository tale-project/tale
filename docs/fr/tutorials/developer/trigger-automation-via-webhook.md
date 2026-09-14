---
title: Déclencher une automation par webhook
description: Installe une automation déployée dans un projet, envoie un webhook et vérifie l’exécution terminée.
---
Relie un événement externe à une automation déployée et vérifie son acceptation puis son résultat. Ce tutoriel utilise un webhook de projet, une clé API pour la configuration et la lecture, et curl pour l’envoi. L’expéditeur externe n’a besoin que de l’URL du webhook.

## Préparer une automation de test sans effet externe

Choisis une automation déployée dont les tests passent et qui ne peut ni envoyer de messages, ni modifier des données clients, ni produire d’autres effets externes. Une transformation qui renvoie son entrée suffit. Crée-la et déploie-la dans l’application ou via [MCP](/fr/develop/mcp-endpoint) ; REST ne crée ni ne déploie les définitions.

Utilise un projet actif où tu peux modifier les données et une clé avec les droits Développeur. Définis `TALE_BASE_URL`, `TALE_API_KEY`, `TALE_ORG_SLUG`, `TALE_PROJECT_ID` et `TALE_AUTOMATION`. L’organisation utilise un slug ; le projet utilise un ID. Dans l’URL, remplace `/` à l’intérieur du nom d’automation par `__`.

## Installer l’automation dans le projet

Une livraison webhook exige que l’automation soit installée dans le projet nommé par l’URL. Installe-la avec le nom dans le chemin et un corps vide :

```bash
curl --fail-with-body --silent --show-error --request POST \
  "$TALE_BASE_URL/api/v1/projects/$TALE_PROJECT_ID/automations/$TALE_AUTOMATION" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG" \
  -H "Content-Type: application/json" --data '{}'
```

La première installation renvoie `201`, la suivante `200`. Un appel à la collection `/automations` n’installe rien. Lis le contrat d’entrée de la version déployée avant d’envoyer une livraison.

## Créer et protéger le déclencheur

Lie un déclencheur webhook à cette nouvelle automation de test :

```bash
curl --fail-with-body --silent --show-error --request PUT \
  "$TALE_BASE_URL/api/v1/automations/$TALE_AUTOMATION/triggers" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG" \
  -H "Content-Type: application/json" --data '{"kind":"webhook"}'
```

Copie le `token` renvoyé dans la variable privée `TALE_WEBHOOK_TOKEN`. Tale ne donne la valeur en clair qu’à la création ou à la rotation. Une lecture ultérieure ne la récupère pas.

<Warning>

L’URL est un identifiant d’accès. Toute personne qui la connaît peut envoyer des livraisons. Garde-la hors du code, des captures et des logs publics. Lier un webhook remplace le déclencheur existant de cette automation ; utilise bien celle choisie pour le test.

</Warning>

Le déclencheur suit le nom de l’automation et utilise sa version déployée. Une nouvelle version peut donc changer le travail exécuté par la même URL. Si elle fuit, remplace le token ou retire le déclencheur. Le désactiver ne fait que le suspendre ; le réactiver rétablit le même token.

## Envoyer une livraison

Envoie l’événement avec un identifiant de livraison stable :

```bash
curl --fail-with-body --silent --show-error \
  "$TALE_BASE_URL/api/projects/$TALE_PROJECT_ID/automations/webhook/$TALE_WEBHOOK_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-12345-paid" \
  --data '{"orderId":"12345","amount":199.0}'
```

L’acceptation renvoie `202` avec `runId`. Conserve cet ID dans `TALE_RUN_ID`. L’automation reçoit `{"trigger":"webhook","payload":<body>}` ; l’ID de commande se trouve donc dans `input.payload.orderId`. Un schéma d’entrée doit décrire cette enveloppe.

Répète la commande. Pendant la fenêtre de déduplication, la réponse garde le même `runId` et ajoute `duplicate: true` ; aucune seconde exécution ne démarre. Les IDs sont retenus 24 heures. Sans en-tête d’ID, seuls les corps aux octets identiques sont dédupliqués pendant deux minutes. Utilise un nouvel ID pour un nouvel événement.

## Vérifier le résultat

Lis l’exécution avec ta clé API dans le même projet :

```bash
curl --fail-with-body --silent --show-error \
  "$TALE_BASE_URL/api/v1/projects/$TALE_PROJECT_ID/runs/$TALE_RUN_ID" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG"
```

Attends un statut final et inspecte `output` et `trace`. Pour la transformation qui renvoie son entrée, vérifie l’ID de commande et le montant envoyés. La réponse de livraison `202` ne prouve pas à elle seule ce résultat.

Si l’exécution échoue, lis `failureCode` et `detail`, puis examine le nœud concerné et les effets déjà produits. Réutiliser le même ID de livraison retrouve l’exécution initiale, même en échec ; cela ne relance pas son travail. Un autre ID démarre un nouveau traitement : vérifie d’abord si les nœuds déjà terminés peuvent être répétés sans risque.

## Reprendre une livraison

| Réponse | Correction |
| --- | --- |
| `400` | Lis `code` et les problèmes d’entrée. Corrige l’enveloppe ou retire le paramètre de requête `projectId`. |
| `403` | Vérifie que le projet est actif et que l’automation y est installée. |
| `404` | Vérifie le token et l’activation. L’endpoint ne révèle pas lequel pose problème. |
| `409` | Lis `code` : déploie une version, corrige le périmètre de l’URL ou résous le conflit de livraison. |
| `413` | Réduis le corps sous 256 KiB ou envoie une référence. |
| `429` | Attends selon `Retry-After`, puis renvoie le même ID de livraison. |

Réessaie les erreurs réseau et temporaires du serveur avec une attente progressive bornée et le même ID. Corrige d’abord les autres erreurs client ; répéter une requête invalide ne répare pas la configuration. Retire le déclencheur de test lorsque tu n’as plus besoin de son URL. La [référence webhook](/fr/develop/webhooks) détaille les en-têtes d’ID, la rotation et les limites.
