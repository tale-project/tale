---
title: Configurer l’import de transcriptions vidéo
description: Diagnostique la récupération, configure fournisseur de jetons ou proxy et gère les sessions de navigateur par organisation.
---

Tale utilise `yt-dlp` pour récupérer le contenu associé aux liens vidéo. La disponibilité dépend de la vidéo, des sous-titres ou de la voie d’extraction prise en charge, ainsi que des contrôles d’accès de la plateforme source. Une vidéo lisible sur ton portable peut refuser le réseau ou la session du serveur.

Ce guide d’exploitation concerne la récupération des transcriptions. Commence par une vidéo publique accessible et examine l’erreur avant d’ajouter des identifiants ou de changer la sortie réseau.

## Identifier l’étape en échec

| Observation | Première vérification |
| --- | --- |
| Une seule vidéo échoue | URL prise en charge, contenu toujours disponible et transcription ou source audio utilisable. |
| Beaucoup de vidéos échouent depuis un hôte | Erreurs de l’extracteur dans le worker, réponses de la plateforme source et chemin réseau de l’hôte. |
| Récupération réussie, recherche de connaissances en échec | Configuration d’embedding de l’organisation et statut d’indexation. |
| Échecs après une session fonctionnelle | Expiration, état du compte source et refroidissement ou retrait de la session. |

Consulte `tale logs backend-worker --tail 200` et le motif d’échec de l’élément. Conserve URL et catégorie d’erreur, mais retire cookies, URL signées et identifiants avant de partager le diagnostic. Une relance peut résoudre un échec temporaire ; des refus identiques répétés demandent une investigation.

## Vérifier le fournisseur de jetons intégré

L’image Platform inclut le plugin de jetons et le déploiement fourni démarre `bgutil-provider` sur le réseau interne. Son adresse par défaut est `http://bgutil-provider:4416`. Il fournit les jetons de preuve d’origine utilisés par certaines requêtes d’extraction ; il ne donne pas accès aux contenus privés et ne garantit pas l’acceptation de la requête.

Vérifie `tale logs bgutil-provider` et son accessibilité depuis le worker. Le service est démarré au mieux : son échec ne bloque pas le déploiement principal, mais peut dégrader la récupération des transcriptions.

`VIDEO_INGEST_POT_PROVIDER_URL` choisit un autre fournisseur. `VIDEO_INGEST_PO_TOKEN` fournit un jeton obtenu manuellement. Garde ces valeurs dans ta configuration de secrets. La [référence d’environnement](/fr/self-hosted/configuration/environment-reference) décrit aussi les options de client d’extraction et de plugin ; modifie-les selon l’erreur observée.

## Configurer un proxy de sortie

Utilise `VIDEO_INGEST_PROXY_URL` lorsque tes récupérations vidéo doivent passer par un proxy approuvé. Métadonnées, sous-titres et audio utilisent ce chemin. Les schémas acceptés sont `http`, `https`, `socks4`, `socks4a`, `socks5` et `socks5h` ; ce dernier résout le DNS côté proxy.

```bash
VIDEO_INGEST_PROXY_URL=socks5h://proxy.example.com:1080
```

Ajoute les identifiants requis via ton gestionnaire de secrets. Une URL invalide ou un schéma non pris en charge est ignoré avec un avertissement : confirme donc la configuration appliquée et une véritable récupération. Recrée le worker après avoir modifié son environnement. Redémarrer le conteneur existant ne recharge pas un `.env` modifié.

Changer de route ne garantit pas l’accès. Vérifie que l’usage du proxy et du compte source est autorisé pour le contenu nécessaire. Si la source reste indisponible, importe une transcription que tu possèdes déjà comme [document de connaissances](/fr/platform/knowledge/documents).

## Importer une session de navigateur autorisée

Le serveur peut utiliser les cookies d’un pool séparé par **organisation et domaine**. Il chiffre les fichiers de cookies avec `ENCRYPTION_SECRET_HEX` et ne les renvoie pas dans les listes. Ce pool appartient à l’ingestion vidéo côté serveur ; il n’exporte pas les cookies vers les scripts des agents.

Il n’existe pas de formulaire d’import dans l’application. L’écriture REST exige une clé dont l’utilisateur administre une organisation et figure dans `TALE_DEPLOYMENT_CONFIG_ADMINS`. La clé doit aussi résoudre l’organisation cible. `GET /api/v1/me` indique `capabilities.deploymentEditor` pour cette clé. Nomme explicitement l’organisation avec `X-Organization-Slug`, surtout si le compte en rejoint plusieurs.

1. Exporte un fichier de cookies au format Netscape depuis une session autorisée pour le domaine source. Traite-le comme des identifiants de compte et exclus-le du dépôt.
2. Définis `TALE_URL`, `TALE_API_KEY` et `TALE_ORG_SLUG` pour la bonne instance et organisation. Limite la lecture de `cookies.txt` au compte de l’opérateur.
3. Importe le fichier sans placer son contenu dans les arguments de commande :

```bash
jq -n --arg domain youtube.com --rawfile cookiesJar cookies.txt \
  '{domain: $domain, cookiesJar: $cookiesJar, label: "operator-managed session"}' |
  curl --fail-with-body -sS -X POST "$TALE_URL/api/v1/browser-sessions/import" \
    -H "Authorization: Bearer $TALE_API_KEY" \
    -H "X-Organization-Slug: $TALE_ORG_SLUG" \
    -H 'Content-Type: application/json' \
    --data-binary @-
```

Un import réussi renvoie HTTP 201 avec `sessionId`. Des données invalides provoquent un refus de validation ; un manque de permissions renvoie 403. Résous le contrôle indiqué plutôt que d’accorder un rôle plus large uniquement pour faire passer la requête.

## Vérifier et révoquer les sessions

```bash
curl --fail-with-body -sS "$TALE_URL/api/v1/browser-sessions" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG"
```

La liste présente les métadonnées : statut, expiration et nombre d’échecs. La durée par défaut est 14 jours ; l’import accepte un `ttlMs` positif jusqu’à 180 jours. Les cookies sources peuvent expirer avant : un enregistrement encore valide ne prouve pas que la session du compte fonctionne.

Une récupération bloquée met la session au repos ; des blocages répétés peuvent la retirer. Une tâche planifiée traite les sessions refroidies ou expirées. Une nouvelle tentative peut utiliser une autre session saine de la même organisation et du même domaine. Sans session disponible, la récupération peut continuer avec les autres options configurées.

Pour révoquer une session importée, utilise `DELETE /api/v1/browser-sessions/<sessionId>` avec le même périmètre d’organisation et les permissions d’écriture nécessaires. Confirme l’ID dans la liste auparavant. Renouvelle ou révoque aussi la session du compte source si ses cookies ont été exposés. Relance enfin une vidéo contrôlée et vérifie transcription puis indexation : importer les cookies ne prouve pas que l’ingestion a réussi.
