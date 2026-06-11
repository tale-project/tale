---
title: Politique run-code
description: La liste d'autorisation et la liste de blocage de paquets qui régissent ce que Run code en sandbox peut installer. Les Administrateurs et Propriétaires lisent ceci quand un agent a besoin d'une nouvelle bibliothèque ou quand un audit demande pourquoi un paquet était bloqué à un moment donné.
---

Politique run-code est la surface où tu décides quels paquets Python et Node la sandbox peut installer à l'exécution. Les skills avec scripts et l'outil Run code tournent tous deux dans la même sandbox ; cette politique est la couture unique où tu serres ou desserres ce qu'ils peuvent installer. Les Administrateurs et Propriétaires lisent cette page quand un agent a besoin d'une nouvelle bibliothèque, ou quand un audit demande pourquoi un paquet était bloqué à un moment donné.

## Un basculement mis en pratique

Le mode par défaut est **Liste de blocage** avec liste vide, ce qui veut dire que tous les paquets sont installables. Pour passer à un ensemble curé, ouvre **Paramètres > Gouvernance > Paquets run-code**, change le mode en **Liste d'autorisation** et énumère les paquets de confiance sous **Liste d'autorisation Python** et **Liste d'autorisation Node**. Enregistre et la prochaine exécution sandbox qui demande un paquet hors de la liste échoue avec la raison **absent de la liste d'autorisation** dans l'événement d'audit.

## Les deux modes

| Nom                  | Par défaut | Description                                                                                                                            |
| -------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Liste d'autorisation | off        | Seuls les paquets listés s'installent ; tout le reste est rejeté. À utiliser quand un régulateur nomme les bibliothèques approuvées.   |
| Liste de blocage     | on         | Tous les paquets s'installent sauf ceux listés. À utiliser quand un petit ensemble est connu mauvais et que le reste est de confiance. |

## Les quatre listes

Chaque mode lit deux listes — Python et Node. Un paquet par ligne, ou séparé par des virgules. Les contraintes de version sont retirées automatiquement (`pandas==2.1` correspond à `pandas`), donc la politique est basée sur le nom et survit aux montées de version des bibliothèques. Les paquets Node scopés (`@scope/pkg`) sont pris en charge.

Les listes sont indépendantes par langage : une liste d'autorisation Python plus une liste de blocage Node est une combinaison valide, et veut dire que Python est strict et Node est permissif sur la même sandbox.

## Le testeur

Le panneau Test sur la même page permet de coller des spécifications pip ou npm et voir si chacune passerait sous le brouillon courant. Il utilise tes modifications non enregistrées, donc tu peux itérer avant d'enregistrer. Chaque spécification est parsée, dépouillée de sa contrainte de version et confrontée aux listes ; le panneau rapporte **Autorisé** ou **Refusé** avec la raison — correspond-à-la-liste-d'autorisation, absent-de-la-liste-d'autorisation, correspond-à-la-liste-de-blocage, absent-de-la-liste-de-blocage.

## Egress réseau et skills

La politique de paquets régit _ce qui_ tourne dans la sandbox. La même sandbox fait tourner les scripts de skill — voir la [page concept Skills](/fr/platform/agents/skills). Le réseau sortant depuis le code sandbox est ouvert par défaut, les métadonnées cloud et les plages privées étant toujours bloquées ; sur les déploiements auto-hébergés, l'opérateur peut le restreindre à une allowlist d'hôtes au niveau du déploiement — la marche à suivre vit dans [Durcissement](/fr/self-hosted/operate/security/hardening). Traite la publication d'un skill avec script comme un élargissement de la surface de confiance pour chaque agent qui l'adopte ; la politique de paquets et la politique d'egress du déploiement décident ensemble ce que le script peut faire.

## Où cela s'inscrit

Politique run-code est la porte sur la sandbox qui supporte à la fois l'outil Run code et les scripts de skill. Le concept compagnon est [skills d'agent](/fr/platform/agents/skills) — il couvre quand publier un script comme skill, et pourquoi la politique de paquets est la porte porteuse. La page gouvernance compagnon est [journaux d'audit](/fr/platform/admin/governance/audit-logs) — chaque installation de paquet refusée y atterrit avec la spécification et la raison.
