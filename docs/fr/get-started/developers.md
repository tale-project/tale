---
title: Ta première requête API
description: Crée une clé, identifie ton organisation et trouve les modèles que ton intégration peut appeler.
---
Commence une intégration en vérifiant trois points : la clé permet de s’authentifier, la requête vise la bonne organisation et les ressources nécessaires y sont disponibles. Ce guide effectue ces vérifications avec curl. Il te faut une instance en cours d’exécution et le droit de créer des clés API, généralement avec le rôle Développeur, Admin ou Propriétaire.

## Créer une clé pour l’intégration

Ouvre **Paramètres > API > REST** et choisis **Créer une clé API**. Donne-lui un nom qui décrit son usage, choisis une expiration, puis **Créer la clé**. Copie immédiatement la valeur ; Tale n’affiche le secret qu’une fois.

<Frame caption="Utilise une clé identifiable par intégration pour la remplacer ou la révoquer indépendamment.">

![La boîte de création d’une clé API permet de choisir un nom et une durée de validité avant sa génération.](/images/get-started/settings-api-keys.webp)

</Frame>

Charge le secret dans `TALE_API_KEY` depuis un gestionnaire de secrets ou un environnement shell privé. Définis `TALE_BASE_URL` avec l’adresse de ton instance, par exemple `https://your-host.example.com`. N’ajoute pas encore `/api/v1` ; les commandes le font.

## Identifier le compte et l’organisation

Appelle `/me` sans en-tête d’organisation. Avec une seule appartenance à une organisation, la réponse contient l’identité de la clé et son organisation. Avec plusieurs appartenances, elle renvoie `400 ORG_SLUG_REQUIRED` et propose les organisations dans `data.organizations` :

```bash
curl --fail-with-body --silent --show-error "$TALE_BASE_URL/api/v1/me" \
  -H "Authorization: Bearer $TALE_API_KEY"
```

Définis `TALE_ORG_SLUG` avec le slug choisi, puis rappelle `/me` dans ce périmètre. L’URL du tableau de bord contient un identifiant d’organisation ; ne l’utilise pas comme slug. Une réponse `400` au premier appel fait terminer curl avec le code 22, tout en affichant le contenu JSON.

```bash
curl --fail-with-body --silent --show-error "$TALE_BASE_URL/api/v1/me" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG"
```

Vérifie le compte, l’organisation, les capacités et `key.expiresAt` dans la réponse réussie avant de continuer.

La clé agit avec les appartenances et droits actuels de son titulaire. Plusieurs clés pour un compte ne créent pas des rôles ou budgets de débit indépendants. Prépare le remplacement avant expiration ; `/api/v1` ne gère pas les clés API à ta place.

## Trouver un modèle disponible

Indique explicitement l’organisation lorsque tu listes les modèles :

```bash
curl --fail-with-body --silent --show-error "$TALE_BASE_URL/api/v1/models" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG"
```

<Check>

Une réponse `200` contenant un tableau `models` confirme cette requête authentifiée dans l’organisation. Le tableau peut être vide : cela prouve l’accès à l’endpoint, pas la possibilité de générer une réponse.

</Check>

Utilise l’`id` du modèle dans les requêtes de chat et son `providerSlug` si plusieurs fournisseurs proposent le même ID. Un modèle peut figurer dans la liste sans être accessible au compte du fournisseur, faute de crédit ou d’abonnement adapté. Si la liste est vide, demande à un admin de vérifier les identifiants et les accès.

## Résoudre la première erreur

| Réponse | Action |
| --- | --- |
| `401` | Vérifie la clé bearer, son expiration et sa révocation éventuelle. |
| `400` avec `ORG_SLUG_REQUIRED` | Choisis un slug dans `data.organizations` de cette erreur et envoie `X-Organization-Slug`. |
| `404` avec `ORG_SLUG_INVALID` | L’en-tête ne désigne aucune organisation dont le détenteur de la clé est membre : une faute de frappe, ou l’identifiant d’organisation de l’URL du tableau de bord collé à la place du slug. Envoie le slug donné dans `data.organizations`. |
| `403` | Vérifie l’appartenance et le droit nécessaire à l’opération. |
| `429` | Attends selon `Retry-After` ; consulte les [limites de débit](/fr/develop/rate-limits). |

Si curl signale une erreur TLS ou réseau avant de recevoir du JSON, vérifie l’hôte et le certificat. Ne désactive pas la vérification des certificats dans un script de production.

## Choisir la tâche suivante

| Tu veux… | Poursuis avec |
| --- | --- |
| Afficher une réponse complète | [Appeler Tale depuis un script](/fr/tutorials/developer/call-tale-from-a-script). |
| Lancer une automation depuis un autre système | [Déclencher une automation par webhook](/fr/tutorials/developer/trigger-automation-via-webhook). |
| Connecter un client MCP | [Endpoint MCP](/fr/develop/mcp-endpoint). |
| Utiliser les fichiers, tâches ou exécutions d’un projet | [Référence API](/fr/develop/api-reference). |

Utilise les routes `/api/v1/projects/{id}/...` pour les opérations d’un projet. L’ID du projet appartient au chemin ; le slug de l’organisation appartient à l’en-tête. Garde les deux valeurs explicites dans ta configuration.
