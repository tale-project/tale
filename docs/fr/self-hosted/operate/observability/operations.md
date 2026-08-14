---
title: Opérations
description: Sur quoi alerter, quelles métriques comptent et la checklist d'astreinte quand une instance Tale commence à mal se comporter.
---

La page opérations est le playbook d'alerte — quels signaux valent la peine de réveiller quelqu'un, lesquels peuvent attendre un café, et à quoi ressemblent les cinq premières minutes d'un incident. La surface de métriques de Tale vit derrière `METRICS_BEARER_TOKEN` ; cette page suppose que tu as câblé Prometheus et Grafana selon [Configuration de l'observabilité](/fr/self-hosted/configuration/observability-config) et qu'il te faut maintenant savoir quels chiffres regarder.

L'index par symptôme est dans [Dépannage](/fr/self-hosted/operate/observability/troubleshooting). Cette page est le côté proactif — signaux d'abord, checklist d'astreinte ensuite.

## Signaux qui méritent une alerte

| Signal                                         | Sévérité | Pourquoi ça compte                                              |
| ---------------------------------------------- | -------- | --------------------------------------------------------------- |
| Sonde de santé `tale-proxy` en échec > 1 min   | page     | Chaque utilisateur voit une erreur de connexion                 |
| Taux HTTP 5xx `tale-platform` > 5 %            | page     | L'UI est cassée pour une part significative des requêtes        |
| Tempête de reconnexion WebSocket `tale-convex` | page     | L'UI charge mais aucune donnée ne circule                       |
| Connexions Postgres > 80 % du pool             | warn     | Le prochain pic va commencer à bloquer                          |
| Volume `db-data` > 80 % plein                  | warn     | Le Postgres opérationnel passe en lecture seule à plein         |
| Volume `knowledge-db-data` > 80 % plein        | warn     | L'ingestion échoue quand la base du corpus est pleine           |
| `tale-knowledge-db` injoignable depuis convex  | warn     | La recherche de connaissances renvoie vide ; l'ingestion stagne |
| Taux d'erreur de requête fournisseur > 20 %    | warn     | Le fournisseur LLM amont passe une mauvaise journée             |
| Backup quotidien non écrit                     | page     | Le drill de restauration échouera au pire moment                |
| Renouvellement de cert TLS échoué              | warn     | Renouvelle 30 j avant l'expiration — tu as le temps             |

Les deux premières pages sont les seules réellement client-impactantes. Les warns attrapent les tendances avant qu'elles ne basculent dans le territoire page.

## Signaux de logs à grepper

Les logs arrivent par stdout par conteneur, capturés par le driver `json-file` de Docker. Les quatre phrases qui signifient consistamment un souci :

- `panic` ou `unexpected error` dans les logs `tale-convex` — crash d'action Convex.
- `decryption failed` dans les logs `tale-platform` — mismatch entre clé age SOPS et fichier sur disque.
- `429 Too Many Requests` répété d'un fournisseur — rate limit atteint, les agents vont commencer à échouer.
- `connection refused` ou `ECONNREFUSED` vers `knowledge-db` dans les logs `tale-convex` — le backend ne peut pas joindre la base du corpus ; l'ingestion et la recherche de connaissances échouent.

Pipe ceux-ci vers ton aggregator comme alertes dérivées ; les endpoints de métriques ne les exposent pas comme gauges.

## Checklist d'astreinte

Quand une page atterrit, les cinq premières minutes suivent la même forme à chaque fois.

1. **Confirme que l'alerte est réelle.** Ouvre `$SITE_URL` dans un navigateur. Si l'UI charge et que le chat marche, tu regardes un souci de métriques ou de scraper, pas un client-impactant.
2. **Identifie le conteneur.** `docker compose ps` montre lequel est unhealthy ; `docker compose logs --tail=200 <service>` montre la dernière erreur.
3. **Redémarre le coupable le plus probable.** `docker compose restart <service>` résout une fraction surprenante des incidents — crashs de processus, watchers de fichiers périmés, pools de connexion épuisés. L'architecture est construite pour survivre proprement à un redémarrage de conteneur unique.
4. **Vérifie les fournisseurs amont.** `https://status.openai.com`, `https://status.anthropic.com`, etc. Si le fournisseur brûle, les agents échouent ; Tale n'est pas la cause.
5. **Page l'ingénieur d'astreinte si le symptôme côté utilisateur persiste après un redémarrage.** Pas besoin d'escalader plus tôt — la plupart des incidents se résolvent dans les trois premières étapes.

## Ce qui n'a pas besoin d'astreinte

Une panne de `tale-knowledge-db` est un warn, pas un page. Le planning du crawl web absorbe des heures de downtime sans impact utilisateur, et l'ingestion de documents retente plutôt que de jeter le travail — les téléversements restent en « indexation » jusqu'au retour de la base du corpus. La recherche de connaissances renvoie vide entre-temps, mais les chats qui ne récupèrent pas de connaissances continuent de marcher. Attrape ça dans la bande warn et corrige-le pendant les heures de bureau.

## SLA de temps de réponse

Deux budgets de temps de réponse sont suivis comme signaux de premier ordre : la saisie de dialogue interactive et les opérations longues comme les évaluations. Les deux sont vérifiés comme une **moyenne** sur une fenêtre glissante — le chiffre contractuel est une moyenne, pas un plafond par requête — et les deux sont câblés pour que Prometheus alerte dès que la moyenne dérive au-delà du budget.

| Budget           | Statistique | Cible | Fenêtre | Série sous-jacente            |
| ---------------- | ----------- | ----- | ------- | ----------------------------- |
| Saisie dialogue  | moyenne     | ~1 s  | 30 min  | `tale_dialog_ttft_seconds`    |
| Opération longue | moyenne     | ~40 s | 6 h     | `tale_long_operation_seconds` |

Chaque cible chevauche aussi l'endpoint de métriques de la plateforme sous `tale_sla_target_seconds{sla,statistic}`, pour qu'un panel Grafana trace la ligne de budget directement depuis Prometheus au lieu de la coder en dur. Les séries de latence sous-jacentes sont les histogrammes d'exécution de fonction Convex sur `/metrics/convex` ; relabel ou record-les vers les noms ci-dessus pour que les rules se résolvent. La plateforme sert les rules de recording et d'alerting prêtes à l'emploi sous `/metrics/sla-rules` (derrière le même bearer token que les autres chemins de métriques) — récupère-le une fois et référence le fichier sous `rule_files:`, ou colle l'équivalent :

```yaml
groups:
  - name: tale-sla-recording
    rules:
      - record: tale_sla_dialog_ttft:mean30m
        expr: rate(tale_dialog_ttft_seconds_sum[30m]) / rate(tale_dialog_ttft_seconds_count[30m])
        labels:
          sla: dialog_ttft
      - record: tale_sla_long_operation:mean6h
        expr: rate(tale_long_operation_seconds_sum[6h]) / rate(tale_long_operation_seconds_count[6h])
        labels:
          sla: long_operation
  - name: tale-sla-alerts
    rules:
      - alert: TaleSlaDialogTtftBreached
        expr: tale_sla_dialog_ttft:mean30m > 1
        for: 15m
        labels:
          severity: warn
          sla: dialog_ttft
        annotations:
          summary: 'Dialog input response time: mean response time over 30m exceeds the 1s SLA'
          description: Mean time-to-first-token for an interactive chat / dialog turn.
      - alert: TaleSlaLongOperationBreached
        expr: tale_sla_long_operation:mean6h > 40
        for: 30m
        labels:
          severity: warn
          sla: long_operation
        annotations:
          summary: 'Long operation response time: mean response time over 6h exceeds the 40s SLA'
          description: Mean end-to-end time for long-running operations such as evaluations.
```

Un breach ici est un **warn**, pas un page : une moyenne qui dérive est une dégradation à traiter pendant les heures de bureau, et les fenêtres `for:` attendent délibérément qu'un pic court s'estompe avant de déclencher. Le budget dialogue de ~1 s se réconcilie avec le time-to-first-token chaud plus lâche de ~3 s du plan de performance manuel — ces ~3 s sont un plafond par requête pour un seul premier token froid (le premier delta texte SSE du fournisseur), routé en Auto, temps modèle et réseau inclus, alors que les ~1 s ici sont la moyenne en régime permanent sur les tours de dialogue, donc des premiers tokens atteignant occasionnellement le plafond restent compatibles avec une moyenne sous la seconde. Tenir la moyenne de 1 s sur des fournisseurs live peut encore exiger l'optimisation du surcoût backend suivie sur l'issue de fonctionnalité ; cette alerte est ce qui confirme si la cible est atteinte.

## Où cela s'inscrit

Les signaux ci-dessus sont le côté proactif d'opérer une instance Tale ; le côté réactif est [Dépannage](/fr/self-hosted/operate/observability/troubleshooting), et la configuration qui fait passer les métriques dans Prometheus est [Configuration de l'observabilité](/fr/self-hosted/configuration/observability-config). Si tu n'as pas encore réglé `METRICS_BEARER_TOKEN`, chaque seuil ci-dessus est non surveillé — commence par là.
