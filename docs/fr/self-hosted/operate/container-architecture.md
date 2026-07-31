---
title: Architecture des conteneurs
description: Quel conteneur possède quel travail dans une instance Tale en marche, le chemin de requête d'un message chat, et à quoi ressemble une panne de chaque conteneur.
---

Une instance Tale, ce sont huit conteneurs câblés par docker compose. La page d'architecture a couvert à quoi sert chaque conteneur ; cette page-ci est la version de l'opérateur — quel conteneur possède quel travail, comment un message chat y circule et à quoi ressemble le mode de défaillance quand l'un d'eux meurt.

Lis ceci quand tu es d'astreinte. Reviens-y quand tu décides quel conteneur rouler en premier pendant une montée de version.

## Les huit conteneurs, avec leurs tâches

| Conteneur                  | Tâche                                                                                                      | Une panne affecte                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `tale-proxy`               | Terminaison TLS + routage en bordure                                                                       | Tous les ingress — aucun client ne joint l'UI                                      |
| `tale-platform`            | Serveur UI, livraison des assets statiques                                                                 | Le navigateur voit 502 ; l'API reste joignable                                     |
| `tale-convex`              | Actions/queries/mutations backend + WebSocket, plus RAG, crawling et génération de documents en in-process | L'UI charge mais sans données ; les chats en vol stagnent ; l'ingestion stagne     |
| `tale-db`                  | Postgres opérationnel pour Convex                                                                          | Convex bascule en lecture seule ; les écritures bloquent                           |
| `tale-knowledge-db`        | Postgres du corpus de connaissances (fragments de documents, embeddings, pages crawlées)                   | La recherche de connaissances renvoie vide ; l'ingestion échoue                    |
| `tale-sandbox-llm-gateway` | Gateway LLM pour les tours sur harness                                                                     | Les tours sur harness ne joignent aucun modèle ; le chat n'est pas affecté         |
| `tale-sandbox-egress`      | Sortie réseau pour code sandbox                                                                            | L'outil **Exécuter du code** échoue avec « egress denied » ; le rendu web échoue   |
| `tale-sandbox`             | Runtime sandbox + navigateur headless pour le rendu web et la génération de documents                      | **Exécuter du code**, le rendu de crawl web et la génération de documents échouent |

Un conteneur est exposé au réseau public (`tale-proxy` pour HTTPS, et optionnellement `tale-sandbox-egress` sortant pour la sandbox) ; le reste est interne seulement. Le sidecar `tale-controller`, à activer explicitement (le profil `controller`), est éteint par défaut ; une fois activé, il redémarre `tale-convex` sur une requête signée pour qu'un changement de résidence des données s'applique sans donner à la plateforme l'accès à Docker.

## Le chemin de requête

Un message chat fait un aller-retour par les conteneurs :

1. Navigateur → `tale-proxy` (TLS terminé).
2. `tale-proxy` → `tale-platform` pour HTML/JS, → `tale-convex` pour API + WebSocket.
3. `tale-convex` lit la config fournisseur de l'organisation, choisit le modèle, ouvre un flux vers le fournisseur amont.
4. Si l'agent récupère des connaissances : `tale-convex` exécute la recherche RAG en in-process, interrogeant directement `tale-knowledge-db` — sans service de récupération séparé sur le chemin.
5. Si l'agent exécute du code : `tale-convex` → `tale-sandbox` → `tale-sandbox-egress` pour tout appel sortant.
6. Le flux du fournisseur renvoie des tokens via `tale-convex` jusqu'au navigateur via le WebSocket.

Le chemin chaud est court. Si la latence du chat semble fausse, le conteneur à blâmer est presque toujours le fournisseur amont, pas Tale ; les endpoints de métriques sur `tale-convex` (qui porte désormais aussi les timings RAG et de crawl) exposent le temps passé à chaque saut.

## Le plan sandbox

L'exécution de code en sandbox tourne dans `tale-sandbox`, avec `tale-sandbox-egress` comme seule couture réseau. La séparation en deux conteneurs est délibérée : `tale-sandbox` lui-même n'a aucune sortie réseau ; chaque requête que le code sandbox fait passe par `tale-sandbox-egress`, qui bloque les métadonnées cloud et les plages privées au niveau IP et — quand l'opérateur définit `SANDBOX_EGRESS_ALLOWLIST` — impose en plus une allowlist d'hôtes en refus par défaut. Si le conteneur egress est down, le code sandbox qui a besoin du réseau échoue en mode fermé avec « egress denied » — pas un timeout silencieux.

Le runtime sandbox embarque Chromium et Playwright, donc le backend convex le réutilise pour le travail headless qu'il ne peut pas faire en in-process : rendre une page JavaScript pendant un crawl web, et transformer du HTML généré en PDF ou en image. Ces tâches tournent comme des exécutions sandbox éphémères plutôt que du code utilisateur, mais elles empruntent la même couture d'egress et d'isolation. La sandbox est le seul conteneur qui exécute du code potentiellement non fiable (scripts de compétence fournis par l'utilisateur, invocations **Exécuter du code** d'agent) ; le reste de la stack exécute le code propre à la plateforme.

## Modes de défaillance — à quoi ressemble une panne de chaque conteneur

**`tale-proxy` en panne.** Le handshake TLS échoue ; chaque client voit une erreur de connexion. Dans l'hôte, les conteneurs plateforme et convex restent debout — redémarre proxy en premier.

**`tale-platform` en panne.** Le navigateur obtient 502 du proxy ; l'API continue de marcher. Les onglets navigateur existants avec assets en cache continuent à parler à convex via le WebSocket et peuvent ne pas s'en apercevoir avant un rechargement.

**`tale-convex` en panne.** Le navigateur charge le shell UI mais rien ne se remplit. Les boucles de reconnexion WebSocket. Redémarrer convex est sûr — les sessions sont côté serveur ; les clients se réabonnent à la reconnexion.

**`tale-db` en panne.** Convex entre dans son mode dégradé : lectures depuis le cache, écritures en file. De longues pannes finissent par afficher des toasts « échec de l'enregistrement ».

**`tale-knowledge-db` en panne.** L'ingestion de documents échoue et la recherche de connaissances renvoie vide — les agents qui récupèrent des connaissances obtiennent un ensemble de résultats vide et un avertissement dans le log d'exécution. Le reste de l'app continue de marcher ; les chats sans connaissances ne sont pas affectés. Redémarrer le conteneur règle ça, et les téléversements en vol retentent à la passe suivante.

**`tale-sandbox` / `tale-sandbox-egress` en panne.** Les appels de l'outil **Exécuter du code** retournent une erreur et les scripts de compétence échouent. Parce que le backend convex rend les pages web et génère les documents via le runtime sandbox, un crawl web qui a besoin de rendu JavaScript et la génération de documents échouent aussi en mode fermé tant que la sandbox est down. Les agents qui n'utilisent aucun de ces éléments continuent de marcher.

**`tale-sandbox-llm-gateway` en panne.** Les tours sur harness perdent leur chemin vers un fournisseur de modèles. Le chat ordinaire — qui appelle les fournisseurs directement depuis convex, pas via la gateway LLM — n'est pas affecté.

## Où cela s'inscrit

Cette page est la carte de l'opérateur ; la [vue d'ensemble de l'architecture](/fr/self-hosted/overview) est l'introduction à la même image, la page [Dépannage](/fr/self-hosted/operate/observability/troubleshooting) est l'index par symptôme quand quelque chose a mal tourné. Si tu fixes des seuils d'alerte, [Opérations](/fr/self-hosted/operate/observability/operations) nomme les signaux à câbler.
