---
title: Surveiller et traiter les incidents
description: Choisis des signaux utiles, interprète les métriques exportées et enquête sur les pannes sans perdre les indices.
---

Surveille les actions que les utilisateurs doivent terminer autant que les services qui les portent. Une sonde HTTP réussie ne prouve pas qu’une connexion, un téléchargement, une recherche ou une automatisation aboutit. Définis la gravité des alertes selon leur impact sur ton instance et associe chacune à un responsable et à une procédure de reprise.

[Configurer l’observabilité](/fr/self-hosted/configuration/observability-config) explique les points d’accès et le jeton. [Prometheus et Grafana](/fr/self-hosted/operate/observability/prometheus-grafana) fournit un exemple de collecte.

## Choisir des signaux qui permettent d’agir

| Signal | Investigation | Quand escalader ? |
| --- | --- | --- |
| Échec de l’URL publique, du certificat ou de la connexion | Vérifie le chemin public depuis l’extérieur de l’hôte, puis les journaux du proxy et du backend. | Les utilisateurs n’accèdent plus à un service nécessaire ou un certificat approche de l’expiration sans renouvellement fonctionnel. |
| Hausse des réponses 5xx du backend | Compare `tale_backend_http_requests_total` par `route` et `status` à l’action affectée. | Les erreurs touchent des utilisateurs actifs ou des intégrations critiques. |
| Stockage inaccessible | Examine `tale_backend_store_up` et la surveillance du stockage lui-même. | Des données, recherches ou fichiers nécessaires sont bloqués. |
| Accumulation de jobs en attente ou en échec | Examine `tale_backend_jobs{state=...}`, les workers et quelques erreurs d’exécution représentatives. | Le retard ne se résorbe plus ou une échéance est menacée. |
| Réduction de l’espace disque ou des connexions disponibles | Utilise la surveillance de l’hôte et de la base ; Tale n’exporte pas toutes ces métriques. | Anticipe assez pour ajouter de la capacité ou corriger la cause. |
| Sauvegarde ou copie planifiée absente | Vérifie le job de sauvegarde, le manifeste complet et la destination externe. | Ton objectif de perte de données maximale n’est plus respecté. |
| Requêtes limitées ou refusées par un fournisseur | Lis sa réponse et l’erreur de l’exécution ; vérifie quota, identifiants et état du fournisseur. | Le travail nécessaire échoue ou attend au-delà du délai admis. |

Une alerte à 80 % d’occupation disque peut servir de point de départ. La croissance et le temps nécessaire pour intervenir comptent davantage qu’un pourcentage universel. Une panne de recherche peut être critique pour une équipe qui dépend des connaissances ; ne la reporte pas automatiquement parce que l’interface charge encore.

## Choisir le bon point de contrôle

Utilise ces chemins sur l’origine publique d’un déploiement de production derrière le proxy fourni :

| Chemin | Ce qu’établit une réponse réussie |
| --- | --- |
| `/health` | Caddy répond `OK`. Ce contrôle reste vert pendant un redémarrage de la plateforme. |
| `/api/health` | Le processus web de la plateforme répond à sa sonde de vie. |
| `/status.json` | Le rapport public sur les dépendances est accessible. Lis le verdict de chaque composant ; les résultats sont conservés cinq secondes en cache. |
| `/status` | Le même rapport de disponibilité sous forme de page lisible. |

Vérifie le contenu attendu autant que le statut HTTP. Un chemin inconnu du frontend, comme `/healthz`, peut renvoyer la structure de l’application avec `200` ; ce n’est pas un rapport de santé. [Page d’état](/fr/develop/status-page) décrit le format de réponse.

## Comprendre ce que les métriques prouvent

Le backend exporte les métriques de processus, les nombres et durées des réponses HTTP, les comptes de jobs, les générations en cours, les flux de notification ouverts, l’état de drainage et l’accessibilité des stockages. Examine les séries réellement exposées par ta version avant d’écrire une alerte.

- `tale_backend_store_up` sonde les **stockages par défaut du déploiement** : base applicative, base de connaissances et bucket. Les connexions propres à une organisation demandent une surveillance distincte.
- Les sondes sont mises en cache pendant 30 secondes. Un `403` lors de la vérification du bucket compte comme accessible : la clé peut simplement ne pas avoir le droit de lister son contenu. La valeur `1` ne prouve pas qu’un objet précis peut être envoyé ou téléchargé.
- `/ready` indique la disponibilité pour le déploiement. Il n’intègre pas la santé des stockages externes ; un réplica prêt peut donc dépendre d’un stockage indisponible.
- L’URL publique des métriques backend peut atteindre différents réplicas d’API. Les métriques de processus concernent celui qui répond ; les compteurs de jobs et de générations lisent un état partagé en base. Ne les additionne pas comme si chaque réplica possédait sa propre file.

Couvre ces limites avec une vérification contrôlée de bout en bout : connecte-toi avec un compte de surveillance, lis un enregistrement connu et teste la fonction de fichier ou de recherche dont ton équipe dépend. Utilise un périmètre dédié sans envoi ni autre effet externe.

## Distinguer les objectifs de latence des mesures

Tale expose `tale_sla_target_seconds` et un modèle de règles sous `/metrics/sla-rules`. Les objectifs actuels sont une moyenne de 1 seconde jusqu’au premier token sur 30 minutes et de 40 secondes pour une opération longue sur 6 heures. Il s’agit de cibles, pas d’observations ni d’une garantie que ton déploiement les respecte.

Les règles générées attendent les histogrammes `tale_dialog_ttft_seconds` et `tale_long_operation_seconds`. Le backend n’émet pas automatiquement ces deux séries. Son histogramme HTTP mesure le traitement d’une requête, pas le délai jusqu’au premier token ni la durée complète d’un travail en file. Instrumente les véritables débuts et fins d’opération, puis confirme la présence d’échantillons avant d’activer ces règles. Une requête vide indique un manque de mesures, pas une latence conforme.

## Enquêter avant de modifier l’état

1. Note l’organisation, l’URL ou l’action affectée, le code d’erreur, la période et l’étendue de l’impact. Vérifie si le problème se reproduit sans modifier de données.
2. Consulte `tale status` et `tale logs <service>`. Pour une installation gérée directement, utilise le nom de service Compose avec `docker compose ps` et `docker compose logs --tail=200 <service>`.
3. Compare les erreurs réseau du navigateur aux journaux API/worker et à l’état des stockages ou fournisseurs. Préserve les journaux utiles avant qu’un redémarrage ne les fasse tourner ou n’en masque le contexte.
4. Corrige la cause identifiée : capacité, connexion, configuration, identifiants ou processus défaillant. Recrée les conteneurs concernés après une modification d’environnement ; `docker compose restart` conserve leur environnement précédent.
5. Après la reprise, vérifie l’action initiale et le travail associé en attente. Note les requêtes ou jobs interrompus qui demandent une relance explicite, puis complète la chronologie de l’incident.

Escalade dès que ta procédure d’incident le demande. Un redémarrage peut interrompre du travail ; ce n’est ni une étape de diagnostic obligatoire ni une raison de retarder l’escalade. [Dépannage](/fr/self-hosted/operate/observability/troubleshooting) associe les symptômes courants à des vérifications plus ciblées.
