---
title: Trouver le service à l’origine d’une panne
description: Suis les requêtes, les jobs et les exécutions sandbox vers les bons journaux et comprends la réparation automatique des index.
---

Commence par la responsabilité de chaque service pour circonscrire une panne avant de modifier des conteneurs. Le stack fourni regroupe bases applicative et de connaissances dans `db` ; Compose depuis les sources peut faire tourner `knowledge-db` séparément. Confirme ton installation avec `tale status` ou l’inventaire de ton orchestrateur.

## Choisir les premiers journaux

| Symptôme | Commencer par | Vérifier ensuite |
| --- | --- | --- |
| URL publique ou TLS en échec | `proxy` | DNS, certificats, ports publics et accès aux services en amont. |
| L’interface ne charge pas | `platform`, puis `proxy` | Santé du service web, fichiers statiques et version déployée. |
| L’interface charge, mais connexion ou requêtes de données échouent | `backend-api` | Santé de l’API, accès à la base, erreurs de requête et routage du proxy. |
| Jobs, automatisations planifiées ou imports bloqués | `backend-worker` | File d’attente, erreurs des jobs, identifiants et stockages nécessaires. |
| Échecs de lecture ou d’écriture dans toute l’application | `db` ou base applicative externe | Connexion, espace disque, verrous et journaux de base. |
| Impossible d’envoyer ou télécharger des fichiers | `backend-api`, puis `object-store` ou bucket externe | Connexion résolue de l’organisation, identifiants, point d’accès public et CORS du navigateur. |
| Un harness ne démarre pas ou n’atteint pas son modèle | `sandbox`, `sandbox-llm-gateway` | Création de session, authentification de la passerelle, disponibilité du modèle et image d’exécution. |
| Accès réseau sandbox ou rendu de page en échec | `sandbox-egress`, `sandbox` | Hôte cible, ports autorisés, règles de sortie et journaux de session. |
| Échec de récupération d’une transcription vidéo | `backend-worker`, `bgutil-provider` | Accès à la vidéo, erreurs de l’extracteur, proxy et état des sessions de navigateur. |

Utilise les noms logiques avec `tale logs <service>`. Pour ton propre Compose, utilise `docker compose logs --tail=200 <service>`. Les noms de conteneurs générés peuvent inclure le projet, la couleur et le numéro de réplica.

## Suivre une requête de chat interactive

1. Le navigateur atteint `proxy`. Les fichiers web vont à `platform` ; les requêtes applicatives et d’authentification vont à `backend-api`.
2. L’API vérifie session et organisation, résout le modèle et les identifiants choisis, puis exécute le tour interactif. Elle stocke sa progression dans la base applicative.
3. Le navigateur lit cette progression via le flux du fil de discussion. `/events` transporte des notifications d’invalidation pour actualiser les données, pas les tokens de la réponse.
4. Les outils de connaissance utilisent la connexion de l’organisation demandeuse. Les fichiers d’origine sont lus selon sa configuration de stockage.
5. Un tour utilisant un harness de codage demande une session sandbox et la passerelle de modèles. Tâches en file, jobs d’agents de workflow et tours de chat REST peuvent aussi dépendre des workers.

Une panne de worker n’a donc pas la même portée qu’une panne d’API, mais elle ne permet pas d’affirmer que tout chat ou travail d’agent reste disponible. Vérifie le point d’entrée et le type d’exécution concernés. Conserve l’erreur initiale avant de relancer un tour qui peut consommer des tokens ou effectuer une action externe.

## Comprendre les dépendances des sandbox

`sandbox` est un spawner qui accède au daemon Docker de l’hôte. Il crée des conteneurs temporaires depuis l’image sandbox-runtime fixée et monte leurs espaces de travail. Les sessions utilisent un réseau isolé : les requêtes web passent par `sandbox-egress`, les appels aux modèles par les accès de session limités de la passerelle.

L’environnement fournit aussi Chromium et Playwright pour le rendu de pages et la génération de documents. Une interface web disponible ne prouve pas que ces exécutions fonctionnent. Vérifie les images, montages de workspace, jeton sandbox partagé et identifiants de passerelle avant d’examiner un script particulier.

Le service de sortie bloque les destinations privées et de métadonnées et peut imposer une liste d’hôtes autorisés. Une sortie indisponible peut provoquer un refus ou une erreur réseau ; le message dépend de l’opération. [Durcissement](/fr/self-hosted/operate/security/hardening) décrit la politique et [Gérer Compose toi-même](/fr/self-hosted/install/own-compose) les capacités et montages requis.

## Reconnaître une réparation d’index de connaissances

Un index BM25 endommagé peut faire échouer l’ingestion alors que les tables de documents restent lisibles. Le backend vérifie les index avec `pdb.verify_index` ; un verrou consultatif coordonne les tentatives de réparation par base. Les bases propres aux organisations sont vérifiées à leur première utilisation.

| Résultat | Comportement du backend | Réponse de l’opérateur |
| --- | --- | --- |
| Index sain | Poursuivre le travail normal. | Aucune réparation nécessaire. |
| Index endommagé jusqu’à `KNOWLEDGE_INDEX_REPAIR_INLINE_MAX_BYTES` | Reconstruire immédiatement et vérifier à nouveau ; la limite par défaut est 1 GiB. | Prévoir un démarrage plus long et examiner le résultat final. |
| Index endommagé plus volumineux | Planifier une reconstruction concurrente en arrière-plan ; l’indexation affectée peut attendre avec un motif de reconstruction. | Suivre le worker et la vérification finale. |
| Échec de réparation ou état non établi | Enregistrer l’échec ; les opérations du corpus peuvent rester indisponibles. | Examiner la cause, les permissions de base et le stockage avant une réparation manuelle. |

Une réparation peut produire les actions d’audit `knowledge_index_repaired`, `knowledge_index_rebuild_scheduled` ou `knowledge_index_repair_failed`, ainsi que des notifications aux administrateurs. L’échec d’une reconstruction ne prouve pas que les documents sources sont perdus. Sa réussite ne remplace pas une sauvegarde de la base.

`KNOWLEDGE_INDEX_REPAIR_DISABLED=1` désactive la vérification automatique ; ce n’est pas une réparation. Des dommages répétés après redémarrage demandent d’examiner l’arrêt de Postgres et le stockage. Préfère un arrêt normal avec son délai de grâce aux arrêts forcés. [Dépannage](/fr/self-hosted/operate/observability/troubleshooting) fournit la vérification d’index en lecture seule et les précautions de reprise.
