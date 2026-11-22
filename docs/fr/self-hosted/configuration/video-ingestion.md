---
title: Configurer l’import de transcriptions vidéo
description: Diagnostique la récupération, configure fournisseur de jetons ou proxy et gère les sessions de navigateur par organisation.
---

Tale utilise `yt-dlp` pour récupérer le contenu associé aux liens vidéo. La disponibilité dépend de la vidéo, des sous-titres ou de la voie d’extraction prise en charge, ainsi que des contrôles d’accès de la plateforme source. Une vidéo lisible sur ton portable peut refuser le réseau ou la session du serveur.

Ce guide d’exploitation concerne la récupération des transcriptions. Tale exécute chaque récupération dans une session sandbox qui lui est propre, à l’écart du backend ; [Où s’exécute la récupération](#where-retrieval-runs) indique ce qu’un déploiement doit fournir pour cela. Commence par une vidéo publique accessible et examine l’erreur avant d’ajouter des identifiants ou de changer la sortie réseau.

## Identifier l’étape en échec

| Observation | Première vérification |
| --- | --- |
| Une seule vidéo échoue | URL prise en charge, contenu toujours disponible et transcription ou source audio utilisable. |
| Beaucoup de vidéos échouent depuis un hôte | Erreurs de l’extracteur dans le worker, réponses de la plateforme source et chemin réseau de l’hôte. |
| Un lien YouTube indique que le serveur doit prouver qu’il n’est pas un robot | Le fournisseur de jetons, désactivé tant que tu ne l’as pas [activé](#token-provider). |
| Les vidéos se heurtent à une vérification anti-robot via tes proxys | Les lignes `[ytdlp] outbound proxy entry` du journal du worker, et si chaque proxy de la liste garde une adresse fixe ([proxy de sortie](#egress-proxy)). |
| Un lien reste **En file d'attente** plusieurs minutes, puis échoue comme problème temporaire | La limite **Sessions de rendu** de l’organisation et la capacité de l’hôte des sandboxes ([Où s’exécute la récupération](#where-retrieval-runs)). |
| Chaque lien indique que le traitement vidéo n’est pas encore activé | L’image d’exécution de la sandbox : une image antérieure à cette version ne contient pas `yt-dlp`. |
| Un lien indique que la vidéo est trop volumineuse pour être traitée | Les [limites de durée et de taille](#limits). |
| Récupération réussie, recherche de connaissances en échec | Configuration d’embedding de l’organisation et statut d’indexation. |
| Échecs après une session fonctionnelle | Expiration, état du compte source et refroidissement ou retrait de la session. |

Consulte `tale logs backend-worker --tail 200` et le motif d’échec de l’élément. Conserve URL et catégorie d’erreur, mais retire cookies, URL signées et identifiants avant de partager le diagnostic. Une relance peut résoudre un échec temporaire ; des refus identiques répétés demandent une investigation.

## Où s’exécute la récupération {#where-retrieval-runs}

Pour chaque lien vidéo, le worker démarre une session sandbox, y exécute `yt-dlp`, puis supprime la session dès que le lien est prêt ou a échoué. `yt-dlp` récupère des pages à n’importe quelle adresse qu’un membre colle et exécute le JavaScript de la plateforme pour atteindre ses flux. Dans une session, il le fait en tant qu’utilisateur sans privilèges, sur un système de fichiers racine en lecture seule, et c’est l’hôte des sandboxes qui admet sa mémoire, au lieu que le backend la porte.

Un déploiement doit fournir trois choses pour cela :

- **Une sandbox en service.** Les déploiements fournis en démarrent toujours une. Son image de session contient `yt-dlp`, le runtime JavaScript dont `yt-dlp` a besoin et le plugin du fournisseur de jetons. Un lien qui échoue avec « Le traitement vidéo n'est pas encore activé — contacte ton administrateur » s’est exécuté dans une image de session antérieure à cette version : utilise l’image d’exécution de la sandbox de la même version que le backend.
- **Une session de rendu libre.** Chaque lien en cours occupe l’une des **Sessions de rendu** de l’organisation, la limite sous **Paramètres > Sandboxes** que l’analyse des sites utilise aussi. Quand aucune n’est libre, ou que l’hôte des sandboxes n’a plus de place pour une session de plus, le lien reste **En file d'attente** et redemande toutes les 5 à 60 secondes. L’attente ne compte pas comme une tentative du lien. Un lien qui a attendu 15 minutes échoue avec « Problème temporaire — réessaie ». [Gérer la capacité des sandboxes](/fr/platform/admin/sandboxes) décrit la limite et la capacité de l’hôte.
- **Une sortie pour la session.** Sans [proxy pour la vidéo](#egress-proxy), les requêtes sortent par le proxy de sortie de la sandbox, qui n’ouvre de tunnels que vers les ports 443 et 80. Si `SANDBOX_EGRESS_ALLOWLIST` restreint les destinations de la sandbox, ajoute les plateformes vidéo que tes membres utilisent et les hôtes depuis lesquels elles servent leurs médias ; sinon, chaque lien échoue dès sa première requête. [Limiter les destinations de la sandbox](/fr/self-hosted/operate/security/hardening#limiter-les-destinations-de-la-sandbox) explique ce réglage.

## Limites de durée et de taille {#limits}

Tale lit les sous-titres qu’une plateforme sert en WebVTT ou en SubRip. Quand une vidéo n’en a dans aucun de ces formats, le worker télécharge son audio pour le modèle de transcription. Il stocke l’audio tel que la plateforme le sert, le plus souvent dans un fichier WebM, M4A ou MP4, et préfère un flux d’au plus 200 Mio : le meilleur flux audio seul qui tient dans cette taille, ou le plus petit quand aucun n’y tient. D’une plateforme qui ne sert l’audio qu’avec une image, il prend une image d’au plus 480 lignes.

| Limite | Valeur | Au-delà |
| --- | --- | --- |
| Durée de la vidéo | 4 heures | Le lien échoue avec « La vidéo dépasse la limite de 4 heures » dès que ses métadonnées sont lues, avant tout téléchargement. |
| Audio tel que la plateforme le sert | 1 Gio | Le lien échoue avec « La vidéo est trop volumineuse pour être traitée » et n’est pas relancé. Joins plutôt l’enregistrement lui-même, ou sa transcription. |
| Une piste de sous-titres | 5 Mio | La piste est ignorée et l’audio est transcrit. |

## Activer le fournisseur de jetons {#token-provider}

YouTube demande à certaines adresses, surtout celles des centres de données, de prouver qu’une requête ne vient pas d’un robot. Le lien échoue alors, et le membre lit que YouTube a demandé à ce serveur de prouver qu’il n’est pas un robot et qu’un administrateur peut activer le fournisseur de jetons.

Ce fournisseur est `bgutil-provider`, un service du réseau interne qui fournit les jetons de preuve d’origine dont une telle requête a besoin. L’image d’exécution de la sandbox inclut son plugin. Un déploiement fourni ne le démarre que sur demande : c’est un conteneur de plus, environ 60 Mio au repos, utile seulement à un déploiement que YouTube met à l’épreuve. Pour l’activer, ajoute cette ligne au `.env` de l’espace de travail et lance `tale deploy` :

```dotenv
VIDEO_INGEST_POT_PROVIDER=true
```

Le déploiement démarre le fournisseur. Dès lors, la session d’une vidéo l’interroge par l’intermédiaire du backend, qui le joint à `http://bgutil-provider:4416`. Retire la ligne, ou mets `false`, et le déploiement suivant retire le fournisseur. Un jeton ne donne pas accès aux contenus privés et ne garantit pas l’acceptation de la requête.

Vérifie `tale logs bgutil-provider` et son accessibilité depuis le backend. Le service est démarré au mieux : son échec ne bloque pas le déploiement principal, mais peut dégrader la récupération des transcriptions.

`VIDEO_INGEST_POT_PROVIDER_URL` désigne à la place un fournisseur à toi, sans autre réglage ; le backend doit pouvoir le joindre, une session n’en a pas besoin. `VIDEO_INGEST_PO_TOKEN` fournit un jeton obtenu manuellement. Garde ces valeurs dans ta configuration de secrets. La [référence d’environnement](/fr/self-hosted/configuration/environment-reference) décrit aussi les options de client d’extraction et de plugin ; modifie-les selon l’erreur observée.

## Configurer un proxy de sortie {#egress-proxy}

Les récupérations vidéo passent par les [proxys sortants](/fr/self-hosted/configuration/environment-reference#outbound-proxies) du déploiement dès que `OUTBOUND_PROXY_URLS` en indique. Une vidéo garde le même proxy pour ses métadonnées, ses sous-titres et son audio. Elle commence sur le proxy par lequel sa plateforme a servi la dernière vidéo, sinon sur le suivant à tour de rôle, car la plateforme acceptera le plus probablement de nouveau un proxy par lequel elle vient de servir une vidéo.

La session d’une vidéo ne se connecte jamais elle-même à un proxy. Elle envoie ses requêtes au backend, qui ouvre la connexion vers le proxy de la vidéo et fait passer le trafic dans les deux sens. Un proxy doit donc être joignable depuis le backend, et ses identifiants n’entrent jamais dans une session. Si l’API et le worker tournent comme des services distincts, donne-leur les mêmes réglages de proxy : le worker choisit le proxy d’une vidéo, et le processus de l’API ne se connecte qu’à un proxy que ses propres réglages indiquent.

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

Pour réserver des proxys à la vidéo, par exemple des proxys sur des réseaux résidentiels ou de fournisseurs d’accès facturés par adresse ou par gigaoctet, indique-les plutôt dans `VIDEO_INGEST_PROXY_URLS`. Les récupérations vidéo passent alors par ces seuls proxys, tandis que les requêtes vers les sites web et les sessions sandbox gardent les proxys sortants, qui peuvent alors inclure un point d’accès rotatif. Une vidéo avance dans cette liste comme décrit plus haut, et chaque entrée doit garder une adresse publique fixe. Quand la vidéo a échoué par chaque proxy de la liste, l’étape se termine avec le motif donné par la plateforme ; elle ne se rabat jamais sur les proxys sortants ni sur une connexion directe. Dans le journal du worker, un changement dans cette liste s’écrit `video proxy entry`, là où un changement dans la liste sortante s’écrit `outbound proxy entry`.

Sépare les entrées par des virgules ou des espaces. Chacune prend la forme `scheme://[user:password@]host[:port]`, avec l’un des schémas `http`, `https`, `socks4`, `socks4a`, `socks5` et `socks5h` ; ce dernier résout le DNS côté proxy. Une entrée mal formée empêche le backend de démarrer, et le message désigne l’entrée par sa position.

```bash
VIDEO_INGEST_PROXY_URLS=socks5h://user-1:password@residential.example:1080,socks5h://user-2:password@residential.example:1080
```

Pour un seul proxy approuvé réservé à la vidéo, définis plutôt `VIDEO_INGEST_PROXY_URL`. Il remplace les proxys sortants pour la vidéo seulement et accepte les mêmes schémas, mais comme proxy unique, il ne répète pas une tentative refusée. Définis soit `VIDEO_INGEST_PROXY_URL`, soit `VIDEO_INGEST_PROXY_URLS` : si les deux sont définis, le backend ne démarre pas.

```bash
VIDEO_INGEST_PROXY_URL=socks5h://proxy.example.com:1080
```

Ajoute les identifiants requis via ton gestionnaire de secrets. Une URL invalide ou un schéma non pris en charge dans `VIDEO_INGEST_PROXY_URL` est ignoré avec un avertissement, et la récupération passe alors par les proxys sortants s’il y en a, comme sans la variable : confirme donc la configuration appliquée et une véritable récupération. Recrée le worker après avoir modifié son environnement. Redémarrer le conteneur existant ne recharge pas un `.env` modifié.

Changer de route ne garantit pas l’accès. Vérifie que l’usage du proxy et du compte source est autorisé pour le contenu nécessaire. Si la source reste indisponible, importe une transcription que tu possèdes déjà comme [document de connaissances](/fr/platform/knowledge/documents).

## Importer une session de navigateur autorisée

Le serveur peut utiliser les cookies d’un pool séparé par **organisation et domaine**. Il chiffre les fichiers de cookies avec `ENCRYPTION_SECRET_HEX` et ne les renvoie pas dans les listes. Ce pool appartient à l’ingestion vidéo côté serveur ; il n’exporte pas les cookies vers les scripts des agents. Pour une vidéo, le worker écrit le fichier de cookies obtenu dans la session sandbox de cette vidéo, qui n’exécute rien d’autre que `yt-dlp` et disparaît dès que le lien est traité.

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
