---
title: API WebDAV
description: Référence de protocole pour le serveur WebDAV de Tale — schéma d’URL, authentification, méthodes supportées, liste de propriétés, sémantique des verrous et limites.
---

Tale expose le dépôt de documents sous `/dav/<orgSlug>/` comme point de terminaison WebDAV Class 2 lecture-écriture (RFC 4918). Cette page est la référence du protocole — la surface filaire dont un implémenteur de client ou un outil tiers a besoin pour intégrer. Pour le guide de configuration utilisateur final et les instructions par client, voir [Plateforme > Connectors > WebDAV](/fr/platform/connectors/webdav).

## Schéma d’URL

```text
/dav/<orgSlug>/documents/<path>      R/W  arbre de documents actifs
/dav/<orgSlug>/.trash/<path>         R/O  documents soft-supprimés (vue corbeille)
/dav/<orgSlug>/                      R/O  collection contenant les deux ci-dessus
```

Les segments sont URL-encodés. Le serveur rejette les segments contenant `/`, `\`, NUL, ou les noms relatifs `.` et `..`. Chaque segment doit faire 1–255 octets. Le `orgSlug` correspond à `[a-zA-Z0-9_-]{1,64}`.

La politique de slash final suit la convention WebDAV : les collections (dossiers) sont référencées avec un slash final, les ressources (fichiers) sans. Beaucoup de clients normalisent à la volée ; le serveur accepte les deux formes à la résolution et émet la forme canonique dans les réponses PROPFIND.

## Authentification

HTTP Basic uniquement. Le champ nom d’utilisateur peut être n’importe quelle valeur non vide — le mot de passe applicatif est la vraie information d’identification, et le serveur ne compare pas le nom d’utilisateur à ton enregistrement de compte. Utiliser l’e-mail de ton compte Tale est la convention pour la lisibilité des journaux d’audit, et les clients qui pré-remplissent depuis le trousseau attendent une chaîne en forme d’e-mail, mais la décision d’authentification se fait uniquement sur le mot de passe. Le mot de passe est un **mot de passe applicatif** généré sous Paramètres > WebDAV. Le mot de passe principal n’est pas accepté sur ce point de terminaison.

```http
Authorization: Basic <base64(email-ou-autre:mot-de-passe-applicatif)>
```

Les mots de passe applicatifs sont hachés avec HMAC-SHA256 sous le secret de déploiement `WEBDAV_APP_PASSWORD_HMAC_KEY`. La clé est dérivée de manière déterministe depuis `INSTANCE_SECRET` par l’entrypoint de la plateforme (prod) et `server.ts` (dev), donc les opérateurs n’ont pas à la définir manuellement ; une valeur explicite dans `.env` remplace la valeur dérivée. La recherche restreint via les quatre premiers caractères du mot de passe (stockés à côté du hash pour une recherche indexée) et vérifie avec une comparaison HMAC à temps constant.

Chaque requête authentifiée vérifie aussi que l’utilisateur est membre actif de l’organisation dans l’URL — une ligne périmée (appartenance retirée après l’émission) est rejetée avec `403`.

`OPTIONS` est la seule méthode autorisée sans authentification ; les clients l’utilisent pour sonder la capacité DAV avant de se connecter.

## Méthodes

| Méthode    | Comportement                                                                                                                                                                                                            | Auth       |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| OPTIONS    | Annoncer les capacités. Renvoie `DAV: 1, 2`, `Allow: …`, et `Microsoft-Server-WebDAV-Extensions: 1` pour la compatibilité Windows.                                                                                      | Anonyme OK |
| PROPFIND   | Lister une ressource (Depth 0) ou les enfants directs d’une collection (Depth 1). La liste de propriétés émise est documentée plus bas. **Depth: infinity est rejeté avec 403** pour éviter des réponses sans borne.    | Requise    |
| PROPPATCH  | Renvoie succès 207 par propriété sans stocker les valeurs. Les dead properties ne sont pas persistées en v1 ; PROPPATCH réussit de manière optimiste pour la compatibilité client.                                      | Requise    |
| GET / HEAD | Streamer le blob du document. Pose `Content-Type`, `Content-Length`, `ETag` et `Last-Modified`. GET sur une collection renvoie 405.                                                                                     | Requise    |
| PUT        | Créer ou remplacer un document. Le nouveau blob est stocké dans le stockage objet ; la ligne du document reçoit `sourceProvider: "webdav"`. Renvoie 201 à la création, 204 à l’écrasement. Exige `Content-Length` ; un corps en chunked est refusé avec 411. | Requise    |
| DELETE     | Soft-supprimer un document (`lifecycleStatus: "trashed"`) ou un dossier (corbeille en cascade sur les documents contenus, hard-supprime les lignes de dossier). Renvoie 204.                                            | Requise    |
| MKCOL      | Créer un dossier sous un parent existant. Corps vide uniquement. Renvoie 201, 405 si la cible existe, 409 si le parent manque.                                                                                          | Requise    |
| MOVE       | Renommer ou déplacer. Atomique pour les documents. Pour les dossiers, met à jour le `parentId` du dossier déplacé. Respecte `Overwrite: T/F` et `If`. Renvoie 201 (nouvelle destination) ou 204 (écrasement).           | Requise    |
| COPY       | Copie côté serveur. Les copies de documents réutilisent le même objet stocké. Les copies de dossiers sont récursives. Respecte `Overwrite` et `If`.                                         | Requise    |
| LOCK       | Verrou d’écriture Class 2 exclusif ou partagé. Timeout depuis le header `Timeout: Second-N`, plafonné à 3600. Rafraîchissement en renvoyant LOCK avec `If: (<opaquelocktoken:...>)` et un corps vide.                   | Requise    |
| UNLOCK     | Libérer un verrou par son jeton. Seul le propriétaire peut libérer. Renvoie 204.                                                                                                                                        | Requise    |

`HEAD` partage son handler avec `GET`, corps en moins.

## Propriétés

PROPFIND renvoie ces propriétés vivantes pour chaque ressource :

- `resourcetype` — `<collection/>` sur les dossiers, vide sur les documents.
- `displayname` — le nom du dossier ou le titre du document.
- `getlastmodified` — horodatage RFC 1123. Les documents utilisent `sourceModifiedAt` s’il est défini, sinon l’heure de création de la ligne.
- `creationdate` — ISO 8601 de l’heure de création de la ligne.
- `getcontenttype` — documents uniquement ; le MIME type au moment du téléversement.
- `getcontentlength` — documents uniquement ; en octets.
- `getetag` — documents uniquement ; le hash de contenu s’il est connu, sinon l’identifiant du document.
- `supportedlock` — annonce le support des verrous d’écriture exclusifs.
- `lockdiscovery` — présent sur les ressources avec verrous actifs.

Les dead properties ne sont pas stockées. PROPPATCH renvoie 200 pour une dead property définie seule, mais définir une propriété live/protégée renvoie un 403 par propriété (`cannot-modify-protected-property`), et toutes les dead properties de la même requête sont alors signalées en 424 Failed Dependency (RFC 4918 §9.2 atomicité). Aucune valeur n’est jamais persistée.

## Sémantique des verrous

Les verrous vivent dans leur propre table Postgres (`app.webdav_locks`), indexés par `(organizationId, resourcePath)`. La forme filaire est `opaquelocktoken:<uuid>`. Le serveur :

- Plafonne le timeout à 3600 secondes. Les requêtes pour des fenêtres plus longues sont silencieusement bornées.
- Traite `LOCK` avec un header `If: (<opaquelocktoken:UUID>)` et un corps vide comme un refresh — l’expiration du verrou existant est repoussée.
- Renvoie `412 Precondition Failed` au refresh si le jeton fourni est inconnu.
- Renvoie `423 Locked` sur `PUT / DELETE / MOVE / COPY / MKCOL / PROPPATCH` contre un chemin verrouillé quand la requête n’a pas de header `If` correspondant.
- Renvoie `412 Precondition Failed` si le jeton `If` fourni ne correspond pas au verrou vivant.
- Expire les verrous paresseusement — la requête de lookup renvoie null pour les lignes expirées et planifie une suppression fire-and-forget.
- Hard-supprime tout verrou détenu sous un mot de passe applicatif quand ce mot de passe est révoqué.

`UNLOCK` requiert à la fois un header `Lock-Token` valide et que l’utilisateur soit le propriétaire du verrou.

## Codes de statut

- `200` — OPTIONS, GET, HEAD, LOCK, refresh LOCK, PROPPATCH (par propriété)
- `201` — création PUT, MKCOL, MOVE/COPY vers une nouvelle destination
- `204` — DELETE, UNLOCK, écrasement PUT, écrasement MOVE/COPY
- `207` — PROPFIND, PROPPATCH (enveloppe multi-status)
- `400` — header `Destination` / `If` / `Lock-Token` / `Timeout` mal formé
- `401` — Basic auth absente ou invalide
- `403` — Depth: infinity rejeté ; tentative d’écriture .trash ; suppression/déplacement de la racine ; mauvais propriétaire de mot de passe applicatif sur UNLOCK ; utilisateur pas membre de l’org ; MOVE/COPY sur lui-même ou dans son propre sous-arbre ; `Destination` cross-org
- `404` — ressource introuvable
- `405` — GET sur une collection ; PUT sur un chemin de collection ; MKCOL sur un chemin existant ; MKCOL racine
- `409` — MKCOL, MOVE ou COPY quand le parent de destination n’existe pas
- `411` — PUT sans `Content-Length` (le transfert chunked n’est pas pris en charge : le corps part vers une URL de stockage objet pré-signée qui a besoin de la longueur dès le départ)
- `412` — non-correspondance de jeton `If` ; précondition `If-Match` / `If-None-Match` échouée ; MOVE/COPY avec `Overwrite: F` sur une destination existante
- `413` — corps PUT au-delà de la limite de taille, ou un corps XML (PROPFIND / PROPPATCH / MKCOL / LOCK) au-delà de 64 Ko
- `415` — MKCOL avec corps XML non vide (extended MKCOL non implémenté)
- `423` — écriture tentée sur un chemin verrouillé sans `If` correspondant
- `502` — `Destination` cross-host ; fetch proxy stockage échoué
- `503` — limite du nombre de LOCK dépassée pour le mot de passe applicatif (avec `Retry-After`)
- `507` — sous-arbre de dossier trop volumineux pour être supprimé, déplacé ou copié en une seule requête

## Conformité

- DAV Class **1** (base) : complète.
- DAV Class **2** (verrouillage) : complète, avec le comportement d’expiration paresseuse décrit ci-dessus.
- DAV Class **3** (calendrier, contacts, recherche, ACL) : non implémentée.

Le serveur annonce `DAV: 1, 2` dans la réponse OPTIONS.

## Limites

- `Depth: infinity` sur PROPFIND est rejeté avec `403`.
- `Timeout: Second-N` sur LOCK est borné à `[1, 3600]`.
- La taille du corps PUT est plafonnée à **5 Go** par défaut (`413` au-delà), appliquée à la fois au reverse-proxy et dans le serveur de plateforme. Les opérateurs peuvent l’ajuster via la variable d’environnement `WEBDAV_MAX_PUT_BYTES`. Le corps est streamé vers une URL S3 pré-signée sans qu’un gros upload soit mis en mémoire tampon côté plateforme. Comme cette URL a besoin de la longueur dès le départ, un PUT sans `Content-Length` (transfert chunked) est refusé avec `411`.
- Les corps XML (PROPFIND / PROPPATCH / MKCOL / LOCK) sont plafonnés à **64 Ko** (`413` au-delà) — ces enveloppes sont minuscules par conception.
- Les mots de passe applicatifs sont hachés avec HMAC-SHA256 ; le secret n’apparaît dans aucune réponse après l’appel de création.
- `lastUsedAt` est patché au plus une fois par minute par mot de passe applicatif pour éviter les write-storms sur les montages actifs.

## Prérequis réseau

Le point de terminaison WebDAV tourne dans le serveur Hono de la plateforme (`platform:3000` en compose). Caddy route `/dav/*` vers lui via le fallback par défaut — aucune configuration supplémentaire n’est requise. Le handler parle directement à Postgres via la connexion base de données du backend ; il n’y a aucun service séparé à joindre.

Pour le dev (`bun run dev`), Vite proxie `/dav` vers le backend — `curl` et les clients peuvent atteindre `http://localhost:3000/dav/<orgSlug>/...` contre un serveur dev qui tourne sans rebuild.

## Sécurité

WebDAV envoie le mot de passe applicatif à chaque requête sous forme de header HTTP Basic — pas de session, pas de rafraîchissement de jeton, juste l’identifiant brut rejoué à chaque PROPFIND, PUT, LOCK et ainsi de suite. Ne monte le point de terminaison que sur HTTPS ; sur HTTP en clair, le mot de passe fuite vers quiconque se trouve sur le câble, et révoquer la ligne est le seul moyen de récupérer. Ne mets jamais le mot de passe applicatif dans l’URL elle-même (la forme abrégée `https://user:pass@host/...`) — la plupart des clients consignent les URL dans l’historique du shell, les rapports de crash et les journaux d’accès du proxy, où l’identifiant survivrait bien après le démontage. Laisse le client WebDAV stocker le mot de passe dans le trousseau du système d’exploitation (macOS Keychain, Windows Credential Manager, GNOME Keyring) et le présenter via l’invite d’identifiants standard.

Le serveur impose TLS au niveau du reverse proxy en production ; le mode dev sur HTTP en clair est uniquement prévu pour les tests `localhost`. Les journaux d’audit enregistrent chaque requête authentifiée avec le préfixe du mot de passe utilisé, donc un identifiant fuité peut être tracé et révoqué sans faire tourner le reste de la flotte d’appareils.

## Comment ça s’intègre

WebDAV est la surface mount-protocole du même dépôt de documents que la [référence de l’API REST](/fr/develop/api-reference) anime pour l’import en lot et la recherche — les deux voies écrivent dans la table que le [Hub de documents](/fr/platform/knowledge/documents) lit, donc un fichier créé via Finder apparaît dans l’interface web sans aucune étape de synchronisation. Le protocole est le bon choix quand un utilisateur veut que ses documents se comportent comme un dossier local ; l’API REST est le bon choix quand un script ou un agent veut un contrôle au niveau de l’octet sur ce qui est écrit et quand. La RFC 4918 est l’autorité au niveau filaire pour tout ce qui se trouve sur cette page.
