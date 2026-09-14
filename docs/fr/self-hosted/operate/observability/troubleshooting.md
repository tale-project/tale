---
title: Dépanner une instance auto-hébergée
description: Pars de l’action en échec, inspecte le bon service et rétablis le fonctionnement sans supprimer les données ni masquer la cause.
---

Note l’heure, l’organisation, l’URL ou l’action concernée et le code d’erreur avant tout redémarrage. Détermine si le problème touche un élément, une organisation ou tout le déploiement. Cette distinction oriente l’enquête vers un fichier, une connexion d’organisation ou l’infrastructure partagée.

Pour un déploiement dans un workspace, commence par `tale status` et `tale logs <service> --tail 200`. Dans ton propre projet Compose, utilise `docker compose ps` et `docker compose logs --tail=200 <service>`. Les noms de services comme `platform` et `backend-api` diffèrent des noms de conteneurs générés.

## Échec de l’URL publique, du certificat ou de la connexion

| Symptôme | Vérification | Étape suivante |
| --- | --- | --- |
| Connexion impossible ou avertissement TLS | DNS, ports publics, nom et émetteur du certificat, journaux du proxy. | Corrige la couche en échec. Avec une CA interne, installe son certificat racine public sur le client ; `docker exec ... caddy trust` ne change pas son magasin de confiance. |
| Réponse 502/503 du proxy | Identifie chemin et service cible. `/api/health` et fichiers web utilisent `platform` ; les requêtes applicatives utilisent `backend-api`. | Examine le démarrage et la disponibilité du service avant de modifier le proxy. |
| `400 BODY_LENGTH_MISMATCH` ou `400 BODY_CHUNK_MALFORMED` | Le corps se termine avant la longueur déclarée ou son découpage HTTP/1.1 en chunks est mal formé. | Corrige le format du corps ou sa longueur déclarée côté émetteur avant de réessayer. |
| Retour à la page de connexion | Cookies et callbacks dans le navigateur ; `SITE_URL`, origines supplémentaires, chemin de base et enregistrement fournisseur. | Corrige l’origine ou le callback, puis recrée les services après les modifications d’environnement. |

Une interface chargée mais vide oriente d’abord vers les requêtes applicatives, pas forcément le serveur web. Examine les requêtes échouées et les journaux `backend-api`. Proxy, session expirée, refus de permission et panne backend demandent des corrections différentes. [TLS et domaines](/fr/self-hosted/configuration/tls-and-domains) et [Authentification](/fr/self-hosted/configuration/authentication) décrivent leur configuration.

## Échec d’envoi ou de téléchargement des fichiers

Compare la réponse du serveur à la requête du navigateur vers l’URL présignée. Une seule organisation peut avoir une connexion de stockage défaillante alors que le bucket par défaut reste accessible.

| Observation | Signification et réponse |
| --- | --- |
| `object store (skipped)` au démarrage | La paire d’identifiants par défaut manque. Vérifie `OBJECT_STORE_ACCESS_KEY` et `OBJECT_STORE_SECRET_KEY`. Ne génère pas de remplaçants pour un stockage existant sans coordonner ses identifiants. |
| `object store (ignored)` | Le fichier est géré par l’opérateur. Examine `default/object-storage/connection.json` ; la synchronisation d’environnement le laisse volontairement intact. |
| `seeded` ou `reconciled` | La connexion par défaut a été écrite ou actualisée depuis l’environnement. Cela ne prouve pas toutes les permissions objet ni le chemin du navigateur. |
| Sonde de stockage en échec | Vérifie point d’accès, réseau, identifiants, existence du bucket et erreur backend détaillée. |
| Test serveur réussi, mais import navigateur en échec | Vérifie point d’accès public, confiance du certificat et CORS du bucket pour l’origine réelle du navigateur. Autorise `GET`, `PUT` et `HEAD` selon les opérations de fichiers. |

`tale_backend_store_up` couvre les valeurs par défaut et mesure l’accessibilité, pas un import complet. Un `403` du stockage objet peut malgré tout donner la valeur `1`. Après correction, vérifie un envoi et un téléchargement contrôlés. [Résidence des données](/fr/self-hosted/configuration/data-residency) explique les changements de connexion et la migration des fichiers.

## Un document reste non indexé

Examine son statut et son motif d’échec, puis les journaux `backend-worker`. Confirme modèle et identifiants d’embedding de l’organisation, dimensions des vecteurs, connexion de connaissances et format du fichier. Un import réussi prouve seulement le stockage du fichier d’origine.

Si un worker ou une dépendance était indisponible, rétablis-le puis vérifie si le job reprend ou demande **Indexer maintenant** dans [Connaissances](/fr/platform/knowledge/documents). Pour une source endommagée, chiffrée ou non prise en charge, corrige le fichier avant de réessayer. Ne supprime pas un document comme première étape : son identité, son historique et ses références peuvent compter.

## Un scan de site signale une erreur de certificat

L’erreur de crawl `tls_error` indique un échec de négociation TLS : certificat expiré, nom d’hôte différent ou chaîne non reconnue, par exemple. Corrige le certificat du site ou la configuration de confiance du processus de crawl, puis lance un nouveau scan. Répéter la même requête ne répare pas la confiance du certificat ; ne désactive pas sa vérification pour masquer l’échec.

`network_error` indique plutôt un échec de connexion. Lis sa cause et vérifie le DNS, le routage et la disponibilité du service. [Explorer les sites web](/fr/platform/knowledge/crawling) explique les erreurs par page et les résultats des scans.

## Postgres de connaissances plante pendant l’ingestion

Des erreurs répétées `PANIC: corrupted page pointers` ou `signal 6` peuvent signaler un index BM25 endommagé. Examine les journaux de la base et le résultat de la réparation automatique dans [Architecture des conteneurs](/fr/self-hosted/operate/container-architecture). Confirme la base exacte : dans le stack fourni, il s’agit de `tale_knowledge` dans `db` ; ailleurs, un service séparé ou un hôte externe peut la porter.

Depuis une session SQL autorisée sur cette base, cette requête vérifie seulement l’index indiqué :

```sql
SELECT * FROM pdb.verify_index('private_knowledge.idx_pk_chunks_bm25');
```

Une fonction absente, un refus de permission ou un délai dépassé ne confirme pas une corruption. Si le dommage est établi et que la réparation automatique a échoué, préserve une sauvegarde et planifie une maintenance de base. Reconstruire un index dérivé diffère de supprimer les tables de documents :

```sql
REINDEX INDEX private_knowledge.idx_pk_chunks_bm25;
```

Cette commande non concurrente peut bloquer du travail. Coordonne-la avec l’exploitation de la base, vérifie de nouveau l’index puis la reprise de l’ingestion. Ne lance pas de réindexation ou d’installation d’extension spéculative sur la mauvaise base. Une corruption répétée demande d’examiner le disque et les arrêts forcés après le délai de grâce.

## Un chat ou une automatisation s’arrête

Lis l’erreur du chat ou de l’exécution et les journaux API/worker correspondants. Un `429` fournisseur, un refus d’identifiants, un timeout, une attente d’approbation et une déconnexion du flux navigateur sont des états différents. Une approbation attend une décision, pas un redémarrage. Un flux coupé peut masquer une opération toujours active ; lis son résultat enregistré avant de relancer.

Pour un échec fournisseur, vérifie quota et permissions des identifiants choisis, ainsi que l’état du fournisseur. Ne change de modèle que si le remplacement est autorisé et adapté. Pour un échec de harness, examine `sandbox`, `sandbox-llm-gateway`, l’image d’exécution et les journaux de session.

## L’accès réseau de la sandbox est refusé

Examine `sandbox-egress` et l’URL cible. Une `SANDBOX_EGRESS_ALLOWLIST` configurée doit contenir l’hôte nécessaire ; les destinations privées et de métadonnées cloud restent bloquées. Les tunnels HTTPS suivent la politique de ports prise en charge. Confirme la destination voulue avant d’élargir la liste, puis recrée le service de sortie après un changement d’environnement.

Un processus de sortie sain ne prouve pas la disponibilité de l’hôte distant, du DNS, du certificat ou du compte. Conserve l’erreur précise dans le rapport d’incident.

## Les écritures échouent ou le stockage se remplit

Vérifie connexion à la base applicative, espace libre, usage des connexions et verrous. Arrête la croissance évitable et récupère de la capacité selon ta procédure de base. Ne supprime pas le contenu des volumes, ne remplace pas les clés de chiffrement et ne suppose pas que les écritures échouées seront rejouées après redémarrage. Vérifie si l’opération a persisté avant de la relancer.

Pour demander de l’aide, fournis versions, erreurs nettoyées, période, périmètre et étapes de reproduction. `tale diagnostics` rassemble un diagnostic ; examine l’archive avant de la partager, car des détails du déploiement peuvent rester sensibles. Signale les défauts reproductibles dans le [suivi des problèmes du projet](https://github.com/tale-project/tale/issues).
