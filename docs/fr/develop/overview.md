---
title: Développement
description: Développement couvre la surface côté consommateur d’API — REST API, webhooks, SDK d’intégration, workflow de développement assisté par IA, page de statut, limites de débit.
---

Développement est la section pour les intégrateurs et les contributeurs — tous ceux qui branchent Tale sur un autre système, construisent au-dessus de l’API ou livrent une modification du code source. Les pages ici décrivent la surface externe (REST, webhooks, endpoints compatibles OpenAI) et le workflow de contribution.

Si tu es à l’intérieur du produit avec le rôle Développeur (construction d’agents, d’automatisations, d’outils sur mesure), l’onglet Plateforme couvre ton quotidien ; Développement sert quand tu es à l’extérieur du produit et que tu lui parles via le fil.

## Pages de cette section

<CardGroup cols="2">

<Card title="Référence API" icon="code" href="/fr/develop/api-reference">

Endpoints, authentification, endpoints compatibles OpenAI, modèle d’erreur, versionnage.

</Card>

<Card title="Webhooks" icon="webhook" href="/fr/develop/webhooks">

Sortants (Tale → toi) et entrants (toi → Tale), signature, idempotence, retraitements.

</Card>

<Card title="Développement assisté par IA" icon="sparkles" href="/fr/develop/ai-assisted-development">

Utiliser les agents Tale pour écrire des workflows Tale, les fichiers de skill `.agents/`.

</Card>

<Card title="Intégrations" icon="plug" href="/fr/develop/integrations">

Intégrations tierces vues côté développeur.

</Card>

<Card title="Page de statut" icon="activity" href="/fr/develop/status-page">

Rapport d’incident pour Cloud, pointeurs de métriques pour auto-hébergé.

</Card>

<Card title="Limites de débit" icon="gauge" href="/fr/develop/rate-limits">

Limites par clé, par IP, par organisation, et comment lire un 429.

</Card>

</CardGroup>

## Où cela s’inscrit

Développement est la section la plus petite, parce que la plupart des utilisateurs n’en ont jamais besoin ; le public se concentre sur deux rôles (Développeur dans le produit, contributeur en dehors), mais elle est porteuse pour les deux. Si tu branches quelque chose d’externe sur Tale, [Référence API](/fr/develop/api-reference) est la première lecture ; si tu contribues au code source, [Contribuer](/fr/self-hosted/contributing-docker) — sous l’onglet Auto-hébergé — est la bonne.
