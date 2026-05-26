---
title: Tale Cloud
description: Tale en édition managée — Ruler GmbH exploite la stack en Suisse et dans l'UE, avec les mêmes fonctionnalités que l'édition auto-hébergée.
---

Tale Cloud est l'édition managée de la plateforme. Ruler GmbH exploite l'infrastructure, la maintient à jour et sauvegardée, et ancre ton locataire dans un datacentre suisse ou européen — ton équipe se concentre sur la création d'agents, l'entretien des connaissances et la mise en production des workflows. Cloud tourne sur la même base de code que [auto-hébergée](/fr/self-hosted), donc chaque fonctionnalité documentée sous [Platform](/fr/platform) est disponible dès le premier jour.

Choisis Cloud quand le périmètre fonctionnel et les certifications comptent plus que l'emplacement physique exact des octets, quand l'alignement ISO 27001, SOC 2 ou RGPD chez l'exploitant est une exigence dure, et quand l'équipe préfère ne pas faire tourner Docker Compose, gérer les upgrades ou surveiller des tableaux de métriques. Choisis [auto-hébergée](/fr/self-hosted) quand souveraineté veut dire « derrière notre pare-feu », quand l'isolation réseau ou un build personnalisé sont non négociables.

## Cloud vs auto-hébergée

Les deux éditions livrent le même produit. Les différences sont opérationnelles.

| Dimension            | Cloud                                                   | Auto-hébergée                                                                           |
| -------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Exploitant           | Ruler GmbH                                              | Ton équipe                                                                              |
| Hébergement          | Suisse ou UE, ancré par locataire                       | Ton infrastructure, où que ce soit                                                      |
| Upgrades             | Automatique, blue-green, sans interruption              | `tale deploy` à ta cadence                                                              |
| Parité fonctionnelle | Identique à l'auto-hébergée                             | Identique au Cloud                                                                      |
| Réseau               | HTTPS public sur `*.tale.cloud` ou domaine personnalisé | Ce que ton VPC et ta stack proxy fournissent                                            |
| Idéal pour           | Les équipes qui veulent Tale sans le poids opérationnel | Les équipes avec exigences de souveraineté, d'isolation réseau ou de build personnalisé |

## Infrastructure

Tale Cloud tourne sur [Exoscale](https://www.exoscale.com/), un fournisseur cloud suisse. Les locataires sont ancrés dans l'un des [datacentres européens d'Exoscale](https://www.exoscale.com/datacenters/) (Suisse ou UE), et Exoscale détient une [attestation BSI C5 Type 2](https://www.exoscale.com/compliance/bsi-c5/) couvrant l'infrastructure compute, stockage et réseau sur laquelle Tale tourne.

La même architecture en conteneurs documentée à l'[aperçu auto-hébergé](/fr/self-hosted/overview) soutient l'édition Cloud — Platform, RAG, Crawler, base de données et le proxy Caddy tournent côte à côte sur un réseau privé, avec des déploiements blue-green pour que les upgrades ne perdent jamais de requêtes. La différence : Ruler GmbH exploite et observe ces services pour que le client n'ait pas à le faire.

## Dans cette section

Les chapitres Cloud couvrent ce qui change quand Tale est managé pour toi — onboarding, facturation, résidence régionale des données, les certifications publiées, et le sous-ensemble d'actions admin qui n'existent que sur Cloud (SSO hébergé, domaines personnalisés, export du journal d'audit). La liste est volontairement courte : chaque parcours fonctionnel vit dans [Platform](/fr/platform) et s'applique ici à l'identique.

- **Onboarding Cloud** — s'inscrire, créer l'organisation, inviter les sièges, connecter un fournisseur. _(Page en cours de réécriture dans le cadre de la refonte de la doc ; en attendant, [Démarrer comme Membre](/fr/platform/member/overview) — le flux produit est identique sur les deux éditions.)_

## Où ça s'inscrit

Cloud est la porte d'entrée pratique vers Tale, et après l'onboarding le vrai travail se passe sous [Platform](/fr/platform) — le flux de création d'agent, l'entretien de la base de connaissances, l'éditeur d'automatisations, les surfaces de gouvernance et d'audit. Les chapitres spécifiques au Cloud couvrent la couche exploitant en dessous : facturation, résidence, authentification hébergée et les certifications que Ruler GmbH publie pour l'auditeur de l'autre côté de la table. Le produit lui-même est documenté une seule fois — pour les deux éditions.
