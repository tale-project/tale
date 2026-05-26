---
title: Opérations
description: Sur quoi alerter, quelles métriques comptent et la checklist d'astreinte quand une instance Tale commence à mal se comporter.
---

La page opérations est le playbook d'alerte — quels signaux valent la peine de réveiller quelqu'un, lesquels peuvent attendre un café, et à quoi ressemblent les cinq premières minutes d'un incident. La surface de métriques de Tale vit derrière `METRICS_BEARER_TOKEN` ; cette page suppose que tu as câblé Prometheus et Grafana selon [Configuration de l'observabilité](/fr/self-hosted/configuration/observability-config) et qu'il te faut maintenant savoir quels chiffres regarder.

L'index par symptôme est dans [Dépannage](/fr/self-hosted/operate/observability/troubleshooting). Cette page est le côté proactif — signaux d'abord, checklist d'astreinte ensuite.

## Signaux qui méritent une alerte

| Signal                                                   | Sévérité | Pourquoi ça compte                                       |
| -------------------------------------------------------- | -------- | -------------------------------------------------------- |
| Sonde de santé `tale-proxy` en échec > 1 min             | page     | Chaque utilisateur voit une erreur de connexion          |
| Taux HTTP 5xx `tale-platform` > 5 %                      | page     | L'UI est cassée pour une part significative des requêtes |
| Tempête de reconnexion WebSocket `tale-convex`           | page     | L'UI charge mais aucune donnée ne circule                |
| Connexions Postgres > 80 % du pool                       | warn     | Le prochain pic va commencer à bloquer                   |
| Volume `db-data` > 80 % plein                            | warn     | Postgres passe en lecture seule à plein                  |
| Profondeur de file d'indexation RAG > 100 pendant 10 min | warn     | Téléversements bloqués en « indexation »                 |
| Taux d'erreur de requête fournisseur > 20 %              | warn     | Le fournisseur LLM amont passe une mauvaise journée      |
| Backup quotidien non écrit                               | page     | Le drill de restauration échouera au pire moment         |
| Renouvellement de cert TLS échoué                        | warn     | Renouvelle 30 j avant l'expiration — tu as le temps      |

Les deux premières pages sont les seules réellement client-impactantes. Les warns attrapent les tendances avant qu'elles ne basculent dans le territoire page.

## Signaux de logs à grepper

Les logs arrivent par stdout par conteneur, capturés par le driver `json-file` de Docker. Les quatre phrases qui signifient consistamment un souci :

- `panic` ou `unexpected error` dans les logs `tale-convex` — crash d'action Convex.
- `decryption failed` dans les logs `tale-platform` — mismatch entre clé age SOPS et fichier sur disque.
- `429 Too Many Requests` répété d'un fournisseur — rate limit atteint, les agents vont commencer à échouer.
- `connection refused` depuis `tale-rag` ou `tale-crawler` — la plateforme ne peut pas joindre un conteneur voisin.

Pipe ceux-ci vers ton aggregator comme alertes dérivées ; les endpoints de métriques ne les exposent pas comme gauges.

## Checklist d'astreinte

Quand une page atterrit, les cinq premières minutes suivent la même forme à chaque fois.

1. **Confirme que l'alerte est réelle.** Ouvre `$SITE_URL` dans un navigateur. Si l'UI charge et que le chat marche, tu regardes un souci de métriques ou de scraper, pas un client-impactant.
2. **Identifie le conteneur.** `docker compose ps` montre lequel est unhealthy ; `docker compose logs --tail=200 <service>` montre la dernière erreur.
3. **Redémarre le coupable le plus probable.** `docker compose restart <service>` résout une fraction surprenante des incidents — crashs de processus, watchers de fichiers périmés, pools de connexion épuisés. L'architecture est construite pour survivre proprement à un redémarrage de conteneur unique.
4. **Vérifie les fournisseurs amont.** `https://status.openai.com`, `https://status.anthropic.com`, etc. Si le fournisseur brûle, les agents échouent ; Tale n'est pas la cause.
5. **Page l'ingénieur d'astreinte si le symptôme côté utilisateur persiste après un redémarrage.** Pas besoin d'escalader plus tôt — la plupart des incidents se résolvent dans les trois premières étapes.

## Ce qui n'a pas besoin d'astreinte

Les pannes de `tale-crawler` et `tale-rag` ne sont pas des pages. Le planning du crawler absorbe des heures de downtime sans impact utilisateur ; les téléversements vers RAG s'empilent plutôt que d'échouer. Attrape-les dans la bande warn et corrige-les pendant les heures de bureau.

## Où cela s'inscrit

Les signaux ci-dessus sont le côté proactif d'opérer une instance Tale ; le côté réactif est [Dépannage](/fr/self-hosted/operate/observability/troubleshooting), et la configuration qui fait passer les métriques dans Prometheus est [Configuration de l'observabilité](/fr/self-hosted/configuration/observability-config). Si tu n'as pas encore réglé `METRICS_BEARER_TOKEN`, chaque seuil ci-dessus est non surveillé — commence par là.
