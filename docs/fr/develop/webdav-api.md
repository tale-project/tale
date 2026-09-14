---
title: API WebDAV
description: Connecte un client de fichiers, vérifie les transferts et gère les droits, les verrous et les limites du protocole WebDAV.
---

Utilise WebDAV lorsqu'un client de fichiers a besoin de dossiers, de téléchargements, d'envois et de verrous d'édition sur HTTP. Le point d'accès expose le centre de documents de l'organisation ; les fichiers des projets restent hors de cette arborescence. Pour Finder, l'Explorateur de fichiers ou un autre client existant, commence par [Configurer WebDAV](/fr/platform/connectors/webdav).

Cette référence s'adresse aux développeurs de clients. Vérifie d'abord une lecture de dossier authentifiée, puis l'envoi d'un petit fichier. Une réponse `207` confirme l'accès ; retrouver exactement les mêmes octets au téléchargement confirme aussi le chemin de stockage.

## Schéma d’URL

| Chemin | Accès | Contenu |
| --- | --- | --- |
| `/dav/<orgSlug>/documents/<path>` | Lecture et écriture | Documents et dossiers actifs du centre de documents |
| `/dav/<orgSlug>/.trash/<path>` | Lecture seule | Documents dans la corbeille |
| `/dav/<orgSlug>/` | Lecture seule | Les deux collections ci-dessus |

Encode chaque segment séparément. L'analyseur normalise Unicode en NFC et retire les espaces en début et fin de nom. Il refuse les noms vides, `.` et `..`, `/`, `\`, les caractères de contrôle et les noms de plus de 255 unités de code UTF-16. Il ne s'agit donc pas d'une limite de 255 octets. Le slug d'organisation respecte `[a-zA-Z0-9_-]{1,64}`.

Ajoute une barre oblique finale aux dossiers, mais pas aux fichiers. Les réponses renvoient des URL canoniques. Pour accéder à un élément existant, reprends son `href` au lieu de le reconstruire à partir du nom affiché, surtout si plusieurs documents d'un dossier portent le même titre.

## Authentification

Génère un mot de passe d'application dans **Paramètres > WebDAV** avec un compte autorisé à accéder aux paramètres développeur. Le mot de passe complet n'apparaît qu'une fois. Donne un libellé distinct à chaque client pour pouvoir révoquer son accès séparément.

| Champ | Valeur |
| --- | --- |
| Schéma HTTP | Basic |
| Nom d'utilisateur | L'adresse e-mail de ton compte ; le serveur accepte toute valeur non vide |
| Mot de passe | Le mot de passe d'application WebDAV généré |
| Organisation | Le slug dans l'URL, vérifié avec l'appartenance actuelle |

Le mot de passe d'application identifie l'utilisateur. Le mot de passe du compte et les clés API REST ne sont pas acceptés. Un mot de passe valide ne remplace pas l'appartenance à l'organisation : si tu n'en es plus membre, la réponse est `403`. Seul `OPTIONS` est accessible sans authentification.

### Vérifier une lecture de dossier

Renseigne l'URL de ton installation et ton e-mail ci-dessous. Chaque commande `curl --user` demande le mot de passe d'application de manière interactive, sans l'inscrire dans la commande ni dans l'historique du terminal.

```bash
export TALE_DAV_URL="https://your-host.example.com/dav/acme/documents"
export TALE_DAV_USER="you@example.com"

curl --user "$TALE_DAV_USER" --request PROPFIND \
  --header 'Depth: 1' "$TALE_DAV_URL/"
```

La réponse attendue est `207 Multi-Status`, avec du XML décrivant la collection et ses enfants directs. Même un dossier vide possède son propre bloc de réponse. Lis le résultat comme du XML, et non du JSON ; un `207` ne garantit pas la réussite de chaque statut qu'il contient.

### Vérifier un envoi et un téléchargement

Choisis un nom de dossier encore inutilisé pour préserver les fichiers existants. Ces commandes créent un dossier, envoient un petit fichier texte puis le téléchargent :

```bash
curl --user "$TALE_DAV_USER" --request MKCOL "$TALE_DAV_URL/Client%20test/"
printf 'Hello from WebDAV.\n' > webdav-test.txt
curl --user "$TALE_DAV_USER" --upload-file webdav-test.txt \
  --header 'Content-Type: text/plain' "$TALE_DAV_URL/Client%20test/webdav-test.txt"
curl --user "$TALE_DAV_USER" "$TALE_DAV_URL/Client%20test/webdav-test.txt"
```

Les réponses attendues sont `201` pour le dossier, `201` pour le fichier, puis le texte `Hello from WebDAV.` au téléchargement. Un envoi sur un fichier existant remplace son contenu et renvoie `204`. Le fichier apparaît aussi dans le centre de documents sans synchronisation supplémentaire.

## Méthodes

Toutes les méthodes sauf `OPTIONS` exigent le mot de passe d'application.

| Méthode | Rôle | Réponse réussie |
| --- | --- | --- |
| `OPTIONS` | Découvrir les capacités et les méthodes autorisées sur la cible | `200`, `DAV: 1, 2`, `Allow` |
| `PROPFIND` | Lire les propriétés ; `Depth: 0` pour la cible seule, `Depth: 1` avec ses enfants directs | `207` en XML |
| `PROPPATCH` | Soumettre des modifications de propriétés ; voir les limites de persistance ci-dessous | `207`, avec un statut par propriété |
| `GET`, `HEAD` | Télécharger un fichier ou lire ses en-têtes | `200` ; les requêtes conditionnelles et par plage peuvent modifier le statut |
| `PUT` | Créer ou remplacer un fichier | `201` créé, `204` remplacé |
| `DELETE` | Mettre les documents à la corbeille ; traiter récursivement un dossier et supprimer ses lignes de dossiers | `204` |
| `MKCOL` | Créer un dossier sous un parent existant | `201` |
| `MOVE` | Renommer ou déplacer un document ou un dossier | `201` nouvelle destination, `204` remplacement |
| `COPY` | Copier côté serveur un document ou une arborescence ; les copies de fichiers partagent les octets stockés | `201` nouvelle destination, `204` remplacement |
| `LOCK` | Obtenir ou renouveler un verrou d'écriture | `200`, avec un jeton de verrou |
| `UNLOCK` | Libérer un verrou appartenant à l'utilisateur appelant | `204` |

`GET` sur un dossier renvoie `405` : utilise `PROPFIND`. Sans en-tête `Depth`, la valeur est `1` ; `Depth: infinity` est refusé avec `403`. Le corps de `MKCOL` doit être vide. `PUT` exige `Content-Length` : envoie un fichier de taille connue plutôt qu'un transfert chunked.

`MOVE` et `COPY` utilisent `Destination` et respectent `Overwrite: T/F` ainsi que `If`. La destination doit rester sur le même hôte et dans la même organisation. Un parent absent produit `409` ; `Overwrite: F` vers une destination existante produit `412`. Le déplacement d'un document est atomique ; celui d'un dossier change son parent. Les opérations destructives respectent aussi les gels juridiques et les restrictions des documents contrôlés.

`Allow` décrit la cible : l'arbre de documents annonce toutes les méthodes ci-dessus, un fichier de la corbeille `OPTIONS, GET, HEAD, PROPFIND`, et la corbeille ou la racine de l'organisation `OPTIONS, PROPFIND`. Une sonde sur un chemin encore impossible à analyser reçoit la liste complète pour découvrir le service. Windows reçoit aussi `MS-Author-Via: DAV` et `Microsoft-Server-WebDAV-Extensions: 1`.

## Propriétés

| Propriété DAV | Signification |
| --- | --- |
| `resourcetype` | `<collection/>` pour un dossier, vide pour un fichier |
| `displayname` | Nom du dossier ou titre du document |
| `getlastmodified` | Horodatage RFC 1123 ; modification de la source, sinon création |
| `creationdate` | Date de création en ISO 8601 |
| `getcontenttype` | Type MIME du fichier |
| `getcontentlength` | Taille du fichier en octets |
| `getetag` | Le même validateur que dans `GET` et `HEAD` |
| `supportedlock` | Prise en charge des verrous d'écriture exclusifs |
| `lockdiscovery` | Informations disponibles sur les verrous actifs |

Les propriétés de fichier ne s'appliquent pas aux collections. L'ETag est le hachage du contenu entre guillemets lorsqu'il existe, sinon un validateur faible fondé sur la taille et la date de modification, par exemple `W/"42-1789373842855"`. Conserve les guillemets et le préfixe `W/`. Ne le remplace pas par l'ID du document et ne déduis pas une égalité octet par octet d'un validateur faible. `GET` accepte les requêtes conditionnelles et les plages d'octets.

<Warning>

Les propriétés personnalisées ne sont pas conservées. Un `PROPPATCH` ne contenant que des propriétés mortes reçoit un `200` par propriété pour la compatibilité des clients, mais une lecture ultérieure ne retrouve pas ces valeurs. Une propriété active protégée reçoit `403` ; les propriétés mortes de la même requête reçoivent alors `424 Failed Dependency`. N'y stocke pas de métadonnées métier.

</Warning>

## Sémantique des verrous

Utilise un verrou d'écriture exclusif et conserve son jeton `opaquelocktoken:<uuid>`. C'est le mode annoncé par le serveur. L'analyseur accepte aussi une portée partagée, mais le stockage n'autorise qu'un verrou actif par ressource. Ne fonde donc pas une édition simultanée sur les verrous partagés.

| Action du client | Requête nécessaire |
| --- | --- |
| Acquérir | `LOCK` avec un corps XML de verrou d'écriture et `Timeout: Second-N` |
| Écrire sous verrou | Ajouter `If: (<opaquelocktoken:...>)` |
| Renouveler | `LOCK` avec un corps vide et le même jeton `If` |
| Libérer | Envoyer `UNLOCK` avec `Lock-Token: <opaquelocktoken:...>` en tant que propriétaire |

La durée est bornée entre 1 et 3600 secondes. Renouvelle le verrou avant son expiration si l'édition dure plus longtemps. Une écriture protégée sans jeton reçoit `423` ; un jeton incorrect ou inconnu lors du renouvellement reçoit `412`. Un verrou peut couvrir les descendants : celui d'un dossier parent peut donc bloquer une écriture en dessous.

Les verrous sont stockés dans Postgres et nettoyés à la demande après expiration. Un verrou expiré ne protège plus la ressource, même si sa ligne existe encore. Révoquer un mot de passe d'application supprime immédiatement ses verrous. Cela permet aussi de débloquer un client qui a disparu pendant une édition, mais déconnecte tous les montages utilisant ce mot de passe.

## Codes de statut

| Statut | Signification et action |
| --- | --- |
| `200`, `201`, `204` | Lecture, création ou modification réussie ; voir le tableau des méthodes |
| `207` | Examiner chaque résultat de ressource ou de propriété dans le XML |
| `400` | Corriger un en-tête `Destination`, `If`, `Lock-Token` ou `Timeout` mal formé |
| `401` | Fournir un mot de passe d'application valide et non révoqué avec Basic |
| `403` | Vérifier appartenance, zone en lecture seule, règles de conservation/document, profondeur, propriétaire et destination |
| `404` | Vérifier le `href` reçu, le slug d'organisation et l'existence de la ressource |
| `405` | Consulter `Allow` ; un dossier ne se télécharge ni ne s'écrase comme un fichier |
| `409` | Créer d'abord le dossier parent de destination |
| `411` | Ajouter `Content-Length` à `PUT` |
| `412` | Relire la ressource ou le verrou ; vérifier `If`, `If-Match`, `If-None-Match` et `Overwrite` |
| `413` | Réduire le fichier ou le XML, ou revoir la limite avec l'opérateur |
| `415` | Envoyer un corps `MKCOL` vide ; le MKCOL étendu n'est pas pris en charge |
| `423` | Obtenir le bon jeton ou attendre/libérer le verrou |
| `502` | Vérifier une destination sur un autre hôte et la connexion au stockage objet |
| `503` | Libérer les verrous inutilisés de ce mot de passe et respecter `Retry-After` |
| `507` | Fractionner l'opération sur l'arborescence |

Ne relance pas automatiquement tous les refus. Un parent absent ou un mauvais identifiant exige une correction ; un conflit de verrou exige de se coordonner avec l'autre personne qui édite.

## Conformité

Le point d'accès annonce `DAV: 1, 2`. Les méthodes et limites de cette page constituent le contrat d'implémentation ; cette annonce ne garantit pas chaque fonction facultative de WebDAV. En particulier, les propriétés personnalisées ne persistent pas et les verrous d'édition partagée ne sont pas disponibles. Les extensions de calendrier, de contacts, de recherche et d'ACL ne sont pas fournies.

Consulte la [RFC 4918](https://www.rfc-editor.org/rfc/rfc4918) pour la syntaxe réseau. La classe de conformité DAV 3 concerne une révision du protocole, et non les extensions de calendrier ou de contacts.

## Limites

| Périmètre | Limite ou comportement |
| --- | --- |
| Liste récursive | `Depth: infinity` refusé ; parcourir un niveau à la fois |
| Durée d'un verrou | 1–3600 secondes |
| Verrous actifs | 200 par mot de passe d'application |
| Taille d'envoi | 5 Go par défaut ; `WEBDAV_MAX_PUT_BYTES` fixe la limite en octets |
| Corps XML | 64 Kio pour `PROPFIND`, `PROPPATCH`, `MKCOL` et `LOCK` |
| Mots de passe | Jusqu'à 50 actifs par utilisateur dans une organisation |
| Dernière utilisation | Mise à jour au plus une fois par minute et par mot de passe |

Les envois sont transmis en flux au stockage objet avec régulation du débit. Le serveur a besoin de la taille avant de créer la requête d'envoi ; un transfert chunked reçoit `411`. Les opérations sur des dossiers disposent d'un budget de parcours limité et peuvent recevoir `507`. Fractionne les grandes arborescences plutôt que de répéter la même opération trop volumineuse.

## Prérequis réseau

Le backend dessert `/dav/*` ; le proxy de la plateforme l'expose sur le même hôte public que Tale. En développement local, Vite relaie `/dav` du port 3000 vers le backend. Les clients peuvent donc utiliser l'origine habituelle de l'application locale. Aucun service WebDAV séparé n'est à déployer.

Une liste peut fonctionner alors qu'un téléchargement ou un envoi échoue : les dossiers dépendent de la base de données, les octets des fichiers dépendent aussi du stockage objet. Teste les deux chemins après une modification du proxy ou du stockage. Aligne la limite du proxy sur `WEBDAV_MAX_PUT_BYTES`.

## Sécurité

Utilise HTTPS pour les montages distants. Basic transmet le mot de passe d'application à chaque requête ; Base64 est un encodage, pas un chiffrement. Le HTTP en clair convient seulement à un test contrôlé sur localhost. Saisis les identifiants dans l'invite du client ou le trousseau du système, jamais dans une URL telle que `https://user:password@host/`.

Le backend conserve des hachages HMAC-SHA256 et un préfixe de recherche de quatre caractères, puis compare les hachages en temps constant. La configuration de démarrage dérive `WEBDAV_APP_PASSWORD_HMAC_KEY` de `INSTANCE_SECRET`, sauf valeur explicite. Conserve ces secrets stables et sauvegardés : changer la clé HMAC invalide les mots de passe existants.

La liste affiche libellé, préfixe, date de création et dernière utilisation. Ces informations aident à repérer et révoquer le mot de passe d'un appareil perdu. La dernière utilisation est une métadonnée actualisée à fréquence limitée, pas un journal complet de chaque requête.

## Comment ça s’intègre

Utilise [REST](/fr/develop/api-reference) pour les imports rattachés à un projet, les IDs explicites et la recherche. WebDAV convient aux clients du centre de documents qui attendent des chemins et des verrous. Les deux accèdent aux documents Tale, mais WebDAV n'expose ni l'arbre de fichiers d'un projet ni toutes les opérations REST.
