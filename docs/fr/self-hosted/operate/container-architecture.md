---
title: Architecture des conteneurs
description: Quel conteneur possède quel travail dans une instance Tale en marche, le chemin de requête d'un message chat, et à quoi ressemble une panne de chaque conteneur.
---

Une instance Tale, ce sont huit conteneurs câblés par docker compose. La page d'architecture a couvert à quoi sert chaque conteneur ; cette page-ci est la version de l'opérateur — quel conteneur possède quel travail, comment un message chat y circule et à quoi ressemble le mode de défaillance quand l'un d'eux meurt.

Lis ceci quand tu es d'astreinte. Reviens-y quand tu décides quel conteneur rouler en premier pendant une montée de version.

## Les huit conteneurs, avec leurs tâches

| Conteneur             | Tâche                                              | Une panne affecte                                                        |
| --------------------- | -------------------------------------------------- | ------------------------------------------------------------------------ |
| `tale-proxy`          | Terminaison TLS + routage en bordure               | Tous les ingress — aucun client ne joint l'UI                            |
| `tale-platform`       | Serveur UI, livraison des assets statiques         | Le navigateur voit 502 ; l'API reste joignable                           |
| `tale-convex`         | Actions/queries/mutations backend + WebSocket      | L'UI charge mais sans données ; les chats en vol stagnent                |
| `tale-db`             | Postgres pour Convex                               | Convex bascule en lecture seule ; les écritures bloquent                 |
| `tale-rag`            | Indexation de documents + récupération vectorielle | Les téléversements s'empilent ; les agents perdent les résultats RAG     |
| `tale-crawler`        | Récupération d'entités Site web                    | Le crawl est en pause ; le contenu existant reste                        |
| `tale-sandbox-egress` | Sortie réseau pour code sandbox                    | L'outil **Exécuter du code** échoue avec « egress denied »               |
| `tale-sandbox`        | Runtime sandbox                                    | L'outil **Exécuter du code** échoue ; les scripts de compétence échouent |

Deux conteneurs exposés au réseau public (`tale-proxy` pour HTTPS, optionnellement `tale-sandbox-egress` sortant pour la sandbox) ; six internes seulement.

## Le chemin de requête

Un message chat fait un aller-retour par cinq des conteneurs :

1. Navigateur → `tale-proxy` (TLS terminé).
2. `tale-proxy` → `tale-platform` pour HTML/JS, → `tale-convex` pour API + WebSocket.
3. `tale-convex` lit la config fournisseur de l'organisation, choisit le modèle, ouvre un flux vers le fournisseur amont.
4. Si l'agent récupère des connaissances : `tale-convex` → `tale-rag` pour la recherche vectorielle.
5. Si l'agent exécute du code : `tale-convex` → `tale-sandbox` → `tale-sandbox-egress` pour tout appel sortant.
6. Le flux du fournisseur renvoie des tokens via `tale-convex` jusqu'au navigateur via le WebSocket.

Le chemin chaud est court. Si la latence du chat semble fausse, le conteneur à blâmer est presque toujours le fournisseur amont, pas Tale ; les endpoints de métriques sur `tale-convex` et `tale-rag` exposent le temps passé à chaque saut.

## Le plan sandbox

L'exécution de code en sandbox tourne dans `tale-sandbox`, avec `tale-sandbox-egress` comme seule couture réseau. La séparation en deux conteneurs est délibérée : `tale-sandbox` lui-même n'a aucune sortie réseau ; chaque requête que le code sandbox fait passe par `tale-sandbox-egress`, qui bloque les métadonnées cloud et les plages privées au niveau IP et — quand l'opérateur définit `SANDBOX_EGRESS_ALLOWLIST` — impose en plus une allowlist d'hôtes en refus par défaut. Si le conteneur egress est down, le code sandbox qui a besoin du réseau échoue en mode fermé avec « egress denied » — pas un timeout silencieux.

La sandbox est le seul conteneur qui exécute du code potentiellement non fiable (scripts de compétence fournis par l'utilisateur, invocations **Exécuter du code** d'agent). Le reste de la stack exécute le code propre à la plateforme.

## Modes de défaillance — à quoi ressemble une panne de chaque conteneur

**`tale-proxy` en panne.** Le handshake TLS échoue ; chaque client voit une erreur de connexion. Dans l'hôte, les conteneurs plateforme et convex restent debout — redémarre proxy en premier.

**`tale-platform` en panne.** Le navigateur obtient 502 du proxy ; l'API continue de marcher. Les onglets navigateur existants avec assets en cache continuent à parler à convex via le WebSocket et peuvent ne pas s'en apercevoir avant un rechargement.

**`tale-convex` en panne.** Le navigateur charge le shell UI mais rien ne se remplit. Les boucles de reconnexion WebSocket. Redémarrer convex est sûr — les sessions sont côté serveur ; les clients se réabonnent à la reconnexion.

**`tale-db` en panne.** Convex entre dans son mode dégradé : lectures depuis le cache, écritures en file. De longues pannes finissent par afficher des toasts « échec de l'enregistrement ».

**`tale-rag` en panne.** Les téléversements restent à l'état « indexation » ; les agents qui tentent de récupérer des connaissances obtiennent un résultat vide et un avertissement dans le log d'exécution. Redémarrer rag draine la file.

**`tale-crawler` en panne.** Le rafraîchissement des entités Site web s'arrête. Le contenu déjà crawlé reste disponible. Aucun impact visible pour l'utilisateur pendant des heures ; la planification du crawler absorbe les courtes pannes.

**Conteneurs sandbox en panne.** Les appels de l'outil **Exécuter du code** retournent une erreur ; les scripts de compétence échouent. Les agents qui n'utilisent ni l'un ni l'autre continuent à marcher.

## Où cela s'inscrit

Cette page est la carte de l'opérateur ; la [vue d'ensemble de l'architecture](/fr/self-hosted/overview) est l'introduction à la même image, la page [Dépannage](/fr/self-hosted/operate/observability/troubleshooting) est l'index par symptôme quand quelque chose a mal tourné. Si tu fixes des seuils d'alerte, [Opérations](/fr/self-hosted/operate/observability/operations) nomme les signaux à câbler.
