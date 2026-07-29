---
title: Page de statut
description: La page de statut publique de Tale — ce qu'elle couvre, comment les incidents sont périmétrés par service, où vit le flux RSS, et en quoi elle diffère de tes métriques auto-hébergées.
---

La page de statut est le registre canonique de la disponibilité de Tale Cloud. Chaque service rotatif a sa propre ligne de statut, l'historique des incidents est conservé pour la piste d'audit, et la page est le canal que Tale utilise pendant un incident — avant que les courriels ne partent, avant que les tickets de support ne soient répondus, la page est mise à jour.

Lis ceci quand quelque chose se conduit mal et que tu veux savoir si c'est juste toi. Abonne-toi au flux quand tu es responsable de le connector côté toi — la page te dit quel service s'est dégradé pour que tu routes l'alerte vers la bonne équipe sans réveiller la mauvaise astreinte.

## Un abonnement mis en pratique

La page de statut est à `https://status.tale.dev`. S'abonner prend une URL :

```bash
curl -sS https://status.tale.dev/history.rss
```

Le flux RSS porte chaque changement d'état — ouvert, mise à jour, résolu — pour chaque service. L'abonnement par courriel est le même formulaire en un clic sur la page ; le canal courriel livre les mêmes événements avec un debounce de cinq minutes.

## Périmètre par service

| Service    | Ce qu'il couvre                                                                                 | Quand il passe au rouge                                            |
| ---------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `platform` | L'application TanStack Start + Convex — agents, workflows, connectors, UI.                      | UI injoignable ; l'API renvoie 5xx ; l'auth est cassée.            |
| `rag`      | Le service Python FastAPI de traitement de documents — indexation, récupération.                | Les téléversements de documents calent ; la récupération est vide. |
| `crawler`  | Le service d'extraction web Crawl4AI — utilisé par l'ingestion de documents et le repli Tavily. | Les documents tirés du web échouent ; la recherche profonde cale.  |
| `proxy`    | Le bord Caddy — terminaison TLS, routage HTTP.                                                  | Tout le trafic Tale Cloud est touché.                              |
| `db`       | TimescaleDB — état durable pour la couche Convex et les métadonnées de la plateforme.           | Écritures refusées ; la ligne platform passe aussi au rouge.       |

Chaque ligne porte les 90 derniers jours d'uptime comme un sparkline. Un incident se lit comme une bande colorée sur la ligne ; cliquer la bande ouvre le chronogramme — première mise à jour, suites, résolution, post-mortem quand l'incident en exige un.

## Historique des incidents

L'historique est conservé indéfiniment. Chaque incident enregistre les services touchés, l'énoncé d'impact client, le chronogramme, et le post-mortem quand l'incident dépasse le seuil de sévérité qui en impose un. Le seuil est publié sur la page elle-même ; la règle empirique est tout ce qui a un impact client cross-org et une durée au-dessus de 30 minutes.

La page appartient à la rotation d'astreinte. Les mises à jour sont poussées par l'ingénieur qui tient la page, pas par un système automatisé — le choix est délibéré, parce que la page est aussi le document qui va aux clients et aux auditeurs après coup.

## Auto-hébergé : ce qui change

Les instances auto-hébergées n'apparaissent pas sur `status.tale.dev` — cette page couvre Tale Cloud. Chaque déploiement embarque sa propre page de statut à la place, servie par la plateforme et accessible sans connexion à `https://<ton-hôte>/status`. Elle rend côté serveur un résumé de santé — operational, degraded ou outage — à partir d'une sonde de liveness contre le backend Convex, si bien qu'un opérateur (ou un utilisateur qui vérifie si le souci ne vient que de lui) peut lire la disponibilité sans se connecter. La forme lisible par machine est `https://<ton-hôte>/status.json`, qui renvoie le même résultat en JSON qu'un moniteur d'uptime peut interroger.

Cette page rapporte la disponibilité du déploiement lui-même. Pour un signal d'exploitation plus fin — santé des conteneurs depuis `tale status`, métriques de requêtes depuis les journaux Caddy, et événements du plan de contrôle dans le journal d'audit du produit — la [page de dépannage observabilité](/fr/self-hosted/operate/observability/troubleshooting) associe les symptômes aux journaux.

## Où cela s'inscrit

La page de statut est le canal opérationnel ; [Confiance et conformité](/fr/cloud/trust-and-compliance) est le canal d'audit et liste la page comme preuve du contrôle de disponibilité d'infrastructure. Si tu câbles Tale dans un pipeline et veux que le connector réagisse à une panne Tale, le flux RSS est l'entrée ; si tu lis ceci parce que quelque chose dans ton connector échoue maintenant, la [Référence API](/fr/develop/api-reference) liste les codes d'erreur sur lesquels tu dois brancher.
