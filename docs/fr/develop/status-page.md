---
title: Page de statut
description: Chaque déploiement Tale sert sa propre page de statut et un jumeau JSON pour les moniteurs — ce qu’ils rapportent, comment les interroger, et où vit le signal d’exploitation plus fin.
---

Chaque déploiement Tale répond lui-même à la question « c’est juste moi ? ». La plateforme sert, sans connexion, une page de statut à `https://<ton-hôte>/status` et le même verdict en JSON à `https://<ton-hôte>/status.json`, qu’un moniteur d’uptime peut interroger. La page rend côté serveur un résumé de santé — operational, degraded ou outage — à partir de deux sondes contre le backend : sa liveness, et son propre verdict sur les magasins de données dont il dépend. Un opérateur ou un utilisateur peut ainsi lire la disponibilité sans se connecter.

Lis ceci quand quelque chose se conduit mal et que tu veux savoir si le déploiement tient, ou quand tu câbles un moniteur qui doit réagir à une panne Tale avant que les relances de ton connector n’abandonnent.

## Une interrogation mise en pratique

```bash
curl -sS https://your-host.example.com/status.json
# → { "status": "operational", "checkedAt": "2026-09-12T05:45:20.921Z",
#     "components": [ { "id": "backend", "status": "operational" },
#                     { "id": "database", "status": "operational" },
#                     { "id": "object-store", "status": "operational" } ] }
```

Interroge-la depuis ton moniteur au rythme où tu interroges tout le reste ; elle ne coûte aucun budget API, n’exige aucune clé, et le verdict reste en cache cinq secondes, si bien qu’une interrogation serrée ne tourne pas à la tempête de sondes. La page HTML à `/status` est le même verdict pour une personne. `GET /api/health` est la sonde de liveness moins chère que le contrôle de santé du conteneur utilise — `{"status":"ok","version":"<build>"}`, sans connexion — et celle à choisir quand tu veux seulement savoir si le processus répond.

Le JSON répond `Access-Control-Allow-Origin: *`, un tableau de bord dans le navigateur peut donc l’interroger directement, sans proxy ; `OPTIONS` sur l’une ou l’autre porte répond **204** avec `Allow: GET, HEAD, OPTIONS`, et `HEAD` renvoie les en-têtes seuls. La page HTML ne porte aucun en-tête CORS — une personne l’ouvre directement.

## Le JSON

Le document a trois champs, et le vocabulaire est fermé — branche sur ces orthographes exactes :

- `status` — le verdict global : `operational` quand chaque composant est en service, `outage` quand chaque composant est tombé, `degraded` entre les deux.
- `checkedAt` — le moment où les sondes ont tourné pour la dernière fois, en ISO 8601, UTC.
- `components` — une entrée par composant, toujours dans cet ordre, chacune de la forme `{ "id", "status" }` avec `status` valant `operational` ou `outage` :
  - `backend` — l’étage applicatif qui sert chaque requête ; chaque autre ligne en dépend, un backend tombé les emporte donc toutes avec lui.
  - `database` — la base de données applicative et la base de données de connaissances du déploiement, repliées en une seule ligne : l’une ou l’autre injoignable, la ligne se lit comme tombée.
  - `object-store` — le stockage de fichiers du déploiement, où vivent les documents et les uploads.

Un nouvel id de composant est un changement additif : lis les ids que tu connais et traite ceux que tu ne connais pas comme opaques. L’ensemble des orthographes de `status` ne grandit pas sans une note dans les [notes de version](/fr/self-hosted/operate/release-notes/format).

## Ce que le verdict couvre

Le résumé rapporte la disponibilité du déploiement lui-même : si le backend répond, et si les magasins de données dont il dépend répondent — le backend sonde sa propre base de données, la base de données de connaissances et le stockage objet toutes les trente secondes et rapporte le résultat, si bien qu’une base coincée ou un bucket injoignable apparaît comme un verdict `degraded`, la ligne en défaut marquée, pendant que le backend lui-même reste vert. Il ne rapporte pas la santé des fournisseurs de modèles qu’une organisation a connectés — une panne de fournisseur apparaît sur le tour qui en avait besoin, comme l’`errorCode` que décrit la [référence API](/fr/develop/api-reference) — ni les avis de sécurité, qui ont leur propre [flux](/fr/self-hosted/operate/security/advisories).

## Signal plus fin

Pour le détail d’exploitation — santé des conteneurs depuis `tale status`, métriques de requêtes depuis les journaux Caddy, et événements du plan de contrôle dans le journal d’audit du produit — la [page de dépannage observabilité](/fr/self-hosted/operate/observability/troubleshooting) associe les symptômes aux journaux.

## Tale Cloud

Les déploiements Tale Cloud servent les mêmes `/status` et `/status.json` sur leur propre hôte. Aucun hôte de statut public séparé n’est publié pour l’instant ; quand il y en aura un, cette page le nommera avec son flux d’abonnement.

## Où ça se place

La page de statut est le canal opérationnel ; [Confiance et conformité](/fr/cloud/trust-and-compliance) est le canal d’audit. Si tu lis ceci parce que quelque chose dans ton connector échoue maintenant, la [référence API](/fr/develop/api-reference) liste les codes d’erreur sur lesquels brancher, et [Limites de débit](/fr/develop/rate-limits) explique la 429 qui n’est pas une panne.
