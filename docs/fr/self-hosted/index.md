---
title: Auto-hébergé
description: Tale auto-hébergé tourne sur ton infrastructure — on-premise, dans ton VPC, ou coupé du réseau.
kind: index
---

Tale auto-hébergé tourne sur ta propre infrastructure — on-premise, dans ton VPC, ou coupé du réseau. Neuf conteneurs, tes données sur ton stockage, aucune facturation au siège, et aucun trafic qui rejoint les serveurs de Tale, sauf si tu y pointes un fournisseur.

Cette section s'adresse aux opérateurs : les personnes qui décident où Tale tourne, l'installent, le configurent, le maintiennent à jour et récupèrent le pager quand quelque chose va de travers. Les utilisateurs finaux des instances auto-hébergées lisent surtout l'onglet Plateforme — la surface produit est identique entre les éditions.

## Pages de cette section

**[Vue d'ensemble de l'architecture](/fr/self-hosted/overview)** — ce que fait chaque conteneur, où vivent les données sur le stockage, qui parle à qui.

**[Installation](/fr/self-hosted/install/quickstart)** — quickstart sur portable, installation de production sur un hôte Linux, la référence docker compose, premier admin, l'installateur du CLI.

**[Configuration](/fr/self-hosted/configuration/environment-reference)** — chaque variable d'environnement, fichiers de fournisseur, modes d'authentification, TLS, stockage, rétention, secrets chiffrés par SOPS, observabilité.

**[Exploitation](/fr/self-hosted/operate/container-architecture)** — montées de version, sauvegardes et restauration, observabilité et dépannage, avis de sécurité, durcissement, format des notes de version.

**[Contribuer](/fr/self-hosted/contributing-docker)** — comment construire et tester une modification locale de conteneur.

## Où cela s'inscrit

Auto-hébergé est l'édition où l'opérateur possède davantage de la stack. Si ton équipe est petite et que la charge d'exploitation écraserait le travail produit, [Cloud](/fr/cloud) est l'autre forme du même produit. Si tu montes une instance neuve maintenant, [Quickstart](/fr/self-hosted/install/quickstart) est la lecture suivante adéquate.
