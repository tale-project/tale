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
| Les vidéos se heurtent à une vérification anti-robot via tes proxys | Les lignes `[ytdlp] outbound proxy entry` du journal du worker, et si chaque proxy de la liste garde une adresse fixe ([proxy de sortie](#egress-proxy)). |
| Récupération réussie, recherche de connaissances en échec | Configuration d’embedding de l’organisation et statut d’indexation. |
| Échecs après une session fonctionnelle | Expiration, état du compte source et refroidissement ou retrait de la session. |

Consulte `tale logs backend-worker --tail 200` et le motif d’échec de l’élément. Conserve URL et catégorie d’erreur, mais retire cookies, URL signées et identifiants avant de partager le diagnostic. Une relance peut résoudre un échec temporaire ; des refus identiques répétés demandent une investigation.

## Vérifier le fournisseur de jetons intégré

L’image Platform inclut le plugin de jetons et le déploiement fourni démarre `bgutil-provider` sur le réseau interne. Son adresse par défaut est `http://bgutil-provider:4416`. Il fournit les jetons de preuve d’origine utilisés par certaines requêtes d’extraction ; il ne donne pas accès aux contenus privés et ne garantit pas l’acceptation de la requête.

Vérifie `tale logs bgutil-provider` et son accessibilité depuis le worker. Le service est démarré au mieux : son échec ne bloque pas le déploiement principal, mais peut dégrader la récupération des transcriptions.

`VIDEO_INGEST_POT_PROVIDER_URL` choisit un autre fournisseur. `VIDEO_INGEST_PO_TOKEN` fournit un jeton obtenu manuellement. Garde ces valeurs dans ta configuration de secrets. La [référence d’environnement](/fr/self-hosted/configuration/environment-reference) décrit aussi les options de client d’extraction et de plugin ; modifie-les selon l’erreur observée.

## Configurer un proxy de sortie {#egress-proxy}

Les récupérations vidéo passent par les [proxys sortants](/fr/self-hosted/configuration/environment-reference#outbound-proxies) du déploiement dès que `OUTBOUND_PROXY_URLS` en indique. Une vidéo garde le même proxy pour ses métadonnées, ses sous-titres et son audio. Elle commence sur le proxy par lequel sa plateforme a servi la dernière vidéo, sinon sur le suivant à tour de rôle, car la plateforme acceptera le plus probablement de nouveau un proxy par lequel elle vient de servir une vidéo.

Quand la plateforme refuse la vidéo par ce proxy, par exemple avec une vérification anti-robot, une limite de requêtes ou une requête rejetée, ou quand le proxy ne peut pas transmettre la requête, le worker fait passer la vidéo au proxy suivant à tour de rôle par lequel elle n’a pas encore échoué. La récupération des métadonnées, des sous-titres ou de l’audio fait au plus cinq tentatives et ne réessaie que pendant les 90 premières secondes de cette étape. Quand la récupération d’une vidéo Vimeo par sa page échoue, l’étape des métadonnées essaie aussi le lecteur intégré de Vimeo, qui fait lui aussi jusqu’à cinq tentatives. Le journal du worker désigne chaque changement par la position du proxy dans la liste, jamais par ses identifiants :

```text
[ytdlp] outbound proxy entry 3 (http://gateway.example:80) failed (botDetection); the video goes on through entry 7 (http://gateway.example:80)
```

Quand les tentatives sont épuisées, l’étape se termine comme sans proxy, avec le motif donné par la plateforme. Avec un seul proxy dans la liste, le worker ne répète pas une tentative refusée.

Chaque proxy de la liste doit garder une adresse publique fixe. YouTube signe ses médias pour l’adresse qui les a demandés et peut refuser le téléchargement depuis une autre : un point d’accès rotatif, qui attribue une nouvelle adresse à chaque connexion, n’est donc pas fiable pour la vidéo. Indique plutôt les points d’accès à adresse fixe de ton fournisseur. Beaucoup de fournisseurs les servent depuis une même passerelle, numérotés dans le nom d’utilisateur :

```bash
OUTBOUND_PROXY_URLS=http://user-1:password@gateway.example:80,http://user-2:password@gateway.example:80,http://user-3:password@gateway.example:80
```

Les requêtes vers les sites web prennent toujours ces proxys à tour de rôle. Les plateformes refusent beaucoup d’adresses de centres de données. Si le journal montre des changements pour la plupart des vidéos, des proxys sur des réseaux résidentiels ou de fournisseurs d’accès sont moins souvent refusés.

Définis `VIDEO_INGEST_PROXY_URL` lorsque tes récupérations vidéo doivent plutôt passer par un proxy approuvé qui leur est propre. Il remplace les proxys sortants pour la vidéo seulement ; la liste sortante peut alors garder un point d’accès rotatif. Comme proxy unique, il ne répète pas une tentative refusée. Les schémas acceptés sont `http`, `https`, `socks4`, `socks4a`, `socks5` et `socks5h` ; ce dernier résout le DNS côté proxy.

```bash
VIDEO_INGEST_PROXY_URL=socks5h://proxy.example.com:1080
```

Ajoute les identifiants requis via ton gestionnaire de secrets. Une URL invalide ou un schéma non pris en charge est ignoré avec un avertissement, et la récupération passe alors par les proxys sortants s’il y en a, comme sans la variable : confirme donc la configuration appliquée et une véritable récupération. Recrée le worker après avoir modifié son environnement. Redémarrer le conteneur existant ne recharge pas un `.env` modifié.

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
