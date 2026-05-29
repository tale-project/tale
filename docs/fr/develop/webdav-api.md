---
title: API WebDAV
description: Référence de protocole pour le serveur WebDAV de Tale — schéma d'URL, authentification, méthodes supportées, liste de propriétés, sémantique des verrous et limites.
---

Tale expose le dépôt de documents sous `/dav/<orgSlug>/` comme point de terminaison WebDAV Class 2 lecture-écriture (RFC 4918). Cette page est la référence du protocole — la surface filaire dont un implémenteur de client ou un outil tiers a besoin pour intégrer. Pour le guide de configuration utilisateur final et les instructions par client, voir [Plateforme > Intégrations > WebDAV](/platform/integrations/webdav).

## Schéma d'URL

```
/dav/<orgSlug>/documents/<path>      R/W  arbre de documents actifs
/dav/<orgSlug>/.trash/<path>         R/O  documents soft-supprimés (vue corbeille)
/dav/<orgSlug>/                      R/O  collection contenant les deux ci-dessus
```

Les segments sont URL-encodés. Le serveur rejette les segments contenant `/`, `\`, NUL, ou les noms relatifs `.` et `..`. Chaque segment doit faire 1–255 octets. Le `orgSlug` correspond à `[a-zA-Z0-9_-]{1,64}`.

La politique de slash final suit la convention WebDAV : les collections (dossiers) sont référencées avec un slash final, les ressources (fichiers) sans. Beaucoup de clients normalisent à la volée ; le serveur accepte les deux formes à la résolution et émet la forme canonique dans les réponses PROPFIND.

## Authentification

HTTP Basic uniquement. Le nom d'utilisateur est l'e-mail du compte Tale ; le mot de passe est un **mot de passe applicatif** généré sous Paramètres > WebDAV. Le mot de passe principal n'est pas accepté sur ce point de terminaison.

```
Authorization: Basic <base64(email:mot-de-passe-applicatif)>
```

Les mots de passe applicatifs sont hachés avec HMAC-SHA256 sous le secret de déploiement `WEBDAV_APP_PASSWORD_HMAC_KEY`. La recherche restreint via les quatre premiers caractères du mot de passe (stockés à côté du hash pour une recherche indexée) et vérifie avec une comparaison HMAC à temps constant.

Chaque requête authentifiée vérifie aussi que l'utilisateur est membre actif de l'organisation dans l'URL — une ligne périmée (appartenance retirée après l'émission) est rejetée avec `403`.

`OPTIONS` est la seule méthode autorisée sans authentification ; les clients l'utilisent pour sonder la capacité DAV avant de se connecter.

## Méthodes

| Méthode    | Comportement                                                                                                                                                                                                            | Auth       |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| OPTIONS    | Annoncer les capacités. Renvoie `DAV: 1, 2`, `Allow: …`, et `Microsoft-Server-WebDAV-Extensions: 1` pour la compatibilité Windows.                                                                                      | Anonyme OK |
| PROPFIND   | Lister une ressource (Depth 0) ou les enfants directs d'une collection (Depth 1). La liste de propriétés émise est documentée plus bas. **Depth: infinity est rejeté avec 403** pour éviter des réponses sans borne.    | Requise    |
| PROPPATCH  | Renvoie succès 207 par propriété sans stocker les valeurs. Les dead properties ne sont pas persistées en v1 ; PROPPATCH réussit de manière optimiste pour la compatibilité client.                                      | Requise    |
| GET / HEAD | Streamer le blob du document. Pose `Content-Type`, `Content-Length`, `ETag` et `Last-Modified`. GET sur une collection renvoie 405.                                                                                     | Requise    |
| PUT        | Créer ou remplacer un document. Le nouveau blob est stocké dans le stockage Convex avec déduplication par hash ; la ligne du document reçoit `sourceProvider: "webdav"`. Renvoie 201 à la création, 204 à l'écrasement. | Requise    |
| DELETE     | Soft-supprimer un document (`lifecycleStatus: "trashed"`) ou un dossier (corbeille en cascade sur les documents contenus, hard-supprime les lignes de dossier). Renvoie 204.                                            | Requise    |
| MKCOL      | Créer un dossier sous un parent existant. Corps vide uniquement. Renvoie 201, 405 si la cible existe, 409 si le parent manque.                                                                                          | Requise    |
| MOVE       | Renommer ou déplacer. Atomique pour les documents. Pour les dossiers, met à jour le `parentId` du dossier déplacé. Respecte `Overwrite: T/F` et `If`. Renvoie 201 (nouvelle destination) ou 204 (écrasement).           | Requise    |
| COPY       | Copie côté serveur. Les copies de documents réutilisent l'identifiant de stockage Convex (déduplication). Les copies de dossiers sont récursives. Respecte `Overwrite` et `If`.                                         | Requise    |
| LOCK       | Verrou d'écriture Class 2 exclusif ou partagé. Timeout depuis le header `Timeout: Second-N`, plafonné à 3600. Rafraîchissement en renvoyant LOCK avec `If: (<opaquelocktoken:...>)` et un corps vide.                   | Requise    |
| UNLOCK     | Libérer un verrou par son jeton. Seul le propriétaire peut libérer. Renvoie 204.                                                                                                                                        | Requise    |

`HEAD` partage son handler avec `GET`, corps en moins.

## Propriétés

PROPFIND renvoie ces propriétés vivantes pour chaque ressource :

- `resourcetype` — `<collection/>` sur les dossiers, vide sur les documents.
- `displayname` — le nom du dossier ou le titre du document.
- `getlastmodified` — horodatage RFC 1123. Les documents utilisent `sourceModifiedAt` s'il est défini, sinon l'heure de création de la ligne.
- `creationdate` — ISO 8601 de l'heure de création de la ligne.
- `getcontenttype` — documents uniquement ; le MIME type au moment du téléversement.
- `getcontentlength` — documents uniquement ; en octets.
- `getetag` — documents uniquement ; le hash de contenu s'il est connu, sinon l'identifiant du document.
- `supportedlock` — annonce le support des verrous d'écriture exclusifs.
- `lockdiscovery` — présent sur les ressources avec verrous actifs.

Les dead properties ne sont pas stockées. PROPPATCH renvoie 200 par propriété mais aucune valeur n'est persistée.

## Sémantique des verrous

Les verrous vivent dans leur propre table Convex, indexés par `(organizationId, resourcePath)`. La forme filaire est `opaquelocktoken:<uuid>`. Le serveur :

- Plafonne le timeout à 3600 secondes. Les requêtes pour des fenêtres plus longues sont silencieusement bornées.
- Traite `LOCK` avec un header `If: (<opaquelocktoken:UUID>)` et un corps vide comme un refresh — l'expiration du verrou existant est repoussée.
- Renvoie `412 Precondition Failed` au refresh si le jeton fourni est inconnu.
- Renvoie `423 Locked` sur `PUT / DELETE / MOVE / COPY / MKCOL / PROPPATCH` contre un chemin verrouillé quand la requête n'a pas de header `If` correspondant.
- Renvoie `412 Precondition Failed` si le jeton `If` fourni ne correspond pas au verrou vivant.
- Expire les verrous paresseusement — la requête de lookup renvoie null pour les lignes expirées et planifie une suppression fire-and-forget.
- Hard-supprime tout verrou détenu sous un mot de passe applicatif quand ce mot de passe est révoqué.

`UNLOCK` requiert à la fois un header `Lock-Token` valide et que l'utilisateur soit le propriétaire du verrou.

## Codes de statut

- `200` — OPTIONS, GET, HEAD, LOCK, refresh LOCK, PROPPATCH (par propriété)
- `201` — création PUT, MKCOL, MOVE/COPY vers une nouvelle destination
- `204` — DELETE, UNLOCK, écrasement PUT, écrasement MOVE/COPY
- `207` — PROPFIND, PROPPATCH (enveloppe multi-status)
- `400` — header `Destination` / `If` / `Lock-Token` / `Timeout` mal formé
- `401` — Basic auth absente ou invalide
- `403` — Depth: infinity rejeté ; tentative d'écriture .trash ; suppression/déplacement de la racine ; mauvais propriétaire de mot de passe applicatif sur UNLOCK ; utilisateur pas membre de l'org
- `404` — ressource introuvable
- `405` — GET sur une collection ; MKCOL sur un chemin existant ; MKCOL racine
- `409` — MKCOL quand le parent n'existe pas ; PUT sur un chemin de collection
- `412` — non-correspondance de jeton `If`
- `415` — MKCOL avec corps XML non vide (extended MKCOL non implémenté)
- `423` — écriture tentée sur un chemin verrouillé sans `If` correspondant
- `502` — `Destination` cross-host ou cross-org ; fetch proxy stockage échoué

## Conformité

- DAV Class **1** (base) : complète.
- DAV Class **2** (verrouillage) : complète, avec le comportement d'expiration paresseuse décrit ci-dessus.
- DAV Class **3** (calendrier, contacts, recherche, ACL) : non implémentée.

Le serveur annonce `DAV: 1, 2` dans la réponse OPTIONS.

## Limites

- `Depth: infinity` sur PROPFIND est rejeté avec `403`.
- `Timeout: Second-N` sur LOCK est borné à `[1, 3600]`.
- La taille du corps PUT est bornée par la limite de l'URL d'upload du stockage Convex. Le serveur de plateforme transfère le corps vers une URL pré-signée Convex ; la limite est celle qu'impose votre déploiement Convex self-hosted. Pour du streaming illimité, considérez l'import via l'API REST.
- Les mots de passe applicatifs sont hachés avec HMAC-SHA256 ; le secret n'apparaît dans aucune réponse après l'appel de création.
- `lastUsedAt` est patché au plus une fois par minute par mot de passe applicatif pour éviter les write-storms sur les montages actifs.

## Prérequis réseau

Le point de terminaison WebDAV tourne dans le serveur Hono de la plateforme (`platform:3000` en compose). Caddy route `/dav/*` vers lui via le fallback par défaut — aucune configuration supplémentaire n'est requise. Le chemin requiert que le serveur de plateforme ait `ADMIN_KEY` défini dans son environnement pour appeler les requêtes internes Convex avec auth admin.

Pour le dev (`bun dev`), le même dispatch est monté comme middleware Vite (`vite-plugins/serve-webdav.ts`) — `curl` et les clients peuvent atteindre `http://localhost:3000/dav/<orgSlug>/...` contre un serveur dev qui tourne sans rebuild.

## Voir aussi

- [Plateforme > Intégrations > WebDAV](/platform/integrations/webdav) — guide de configuration utilisateur et instructions par client.
- [Développer > Référence API](/develop/api-reference) — l'API REST pour l'import en lot, la recherche et les autres workflows non-montage.
- RFC 4918 — WebDAV (extensions HTTP pour l'authoring distribué).
