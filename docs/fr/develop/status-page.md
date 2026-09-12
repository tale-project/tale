---
title: Page de statut
description: Chaque déploiement Tale sert sa propre page de statut et un jumeau JSON pour les moniteurs — ce qu’ils rapportent, comment les interroger, et où vit le signal d’exploitation plus fin.
---

Chaque déploiement Tale répond lui-même à la question « c’est juste moi ? ». La plateforme sert, sans connexion, une page de statut à `https://<ton-hôte>/status` et le même verdict en JSON à `https://<ton-hôte>/status.json`, qu’un moniteur d’uptime peut interroger. La page rend côté serveur un résumé de santé — operational, degraded ou outage — à partir d’une sonde de liveness contre le backend, si bien qu’un opérateur ou un utilisateur peut lire la disponibilité sans se connecter.

Lis ceci quand quelque chose se conduit mal et que tu veux savoir si le déploiement tient, ou quand tu câbles un moniteur qui doit réagir à une panne Tale avant que les relances de ton connector n’abandonnent.

## Une interrogation mise en pratique

```bash
curl -sS https://your-host.example.com/status.json
# → { "status": "operational", ... }
```

Interroge-la depuis ton moniteur au rythme où tu interroges tout le reste ; elle ne coûte aucun budget API et n’exige aucune clé. La page HTML à `/status` est le même verdict pour une personne. `GET /api/health` est la sonde de liveness moins chère que le contrôle de santé du conteneur utilise — `{"status":"ok","version":"<build>"}`, sans connexion — et celle à choisir quand tu veux seulement savoir si le processus répond.

## Ce que le verdict couvre

Le résumé rapporte la disponibilité du déploiement lui-même : si le backend répond, et si les magasins de données dont il dépend répondent. Il ne rapporte pas la santé des fournisseurs de modèles qu’une organisation a connectés — une panne de fournisseur apparaît sur le tour qui en avait besoin, comme l’`errorCode` que décrit la [référence API](/fr/develop/api-reference).

## Signal plus fin

Pour le détail d’exploitation — santé des conteneurs depuis `tale status`, métriques de requêtes depuis les journaux Caddy, et événements du plan de contrôle dans le journal d’audit du produit — la [page de dépannage observabilité](/fr/self-hosted/operate/observability/troubleshooting) associe les symptômes aux journaux.

## Tale Cloud

Les déploiements Tale Cloud servent les mêmes `/status` et `/status.json` sur leur propre hôte. Aucun hôte de statut public séparé n’est publié pour l’instant ; quand il y en aura un, cette page le nommera avec son flux d’abonnement.

## Où ça se place

La page de statut est le canal opérationnel ; [Confiance et conformité](/fr/cloud/trust-and-compliance) est le canal d’audit. Si tu lis ceci parce que quelque chose dans ton connector échoue maintenant, la [référence API](/fr/develop/api-reference) liste les codes d’erreur sur lesquels brancher, et [Limites de débit](/fr/develop/rate-limits) explique la 429 qui n’est pas une panne.
