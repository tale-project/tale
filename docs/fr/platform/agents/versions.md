---
title: Versions d’agent
description: La vue Historique de l’éditeur d’agent ne fait pas partie de cette version — les fichiers de persona gardent un historique derrière l’API, et le versionnage visible dans le produit appartient aux automatisations.
---

Cette page décrivait le bouton **Historique** de l’éditeur d’agent — chaque enregistrement un instantané, un diff contre la version actuelle, une restauration en un clic. L’éditeur et sa vue Historique ne font pas partie de cette version de Tale. Le versionnage n’a pas disparu avec eux : les automatisations sont versionnées dans le produit, et les personas d’agent gardent un historique de fichiers que l’API de la plateforme expose.

<Note>

La vue Historique des agents n’est pas disponible dans cette version. Il n’y a pas d’éditeur d’agent depuis lequel l’ouvrir.

</Note>

## Ce qui est versionné aujourd’hui

Les **automatisations** portent le versionnage que tu vois. Chaque enregistrement sur le canvas et chaque paquet téléversé devient une nouvelle version immuable ; tu en mets une en service sur la page de l’automatisation, et la liste **Automatisations** montre pour chacune le nombre de versions à côté de la version en service — ou **Pas en service**. [L’éditeur de workflow](/fr/platform/automations/editor) couvre les versions, les exécutions de test et la mise en service ; [Ajouter des automatisations](/fr/platform/automations/catalog) couvre ce qu’un téléversement ajoute.

Les **personas d’agent** gardent un historique derrière l’API. Chaque enregistrement laisse le fichier remplacé dans la piste d’historique de la persona, et restaurer une entrée sauvegarde d’abord le fichier actuel, si bien qu’une restauration s’ajoute et ne détruit jamais l’état qu’elle remplace ; une entrée d’historique qui ne se parserait plus est refusée avec la raison plutôt qu’écrite. Aucun écran ne montre cette piste dans cette version — elle se lit par l’API propre de la plateforme et, pour les opérateurs auto-hébergés, sur le disque à côté des fichiers de persona. [Agents (vue Admin)](/fr/platform/admin/agents) explique qui peut restaurer quoi.

Les **skills** gardent le `SKILL.md` remplacé quand un paquet téléversé remplace un bundle, comme le décrit [Ajouter des automatisations](/fr/platform/automations/catalog). Pour savoir qui a fait quoi dans l’organisation, les [journaux d’audit](/fr/platform/admin/governance/audit-logs) sont la piste.

## Où cela se place

Les versions vivent, dans cette version, là où l’édition se fait : sur la page de l’automatisation pour les automatisations, dans la piste d’historique pour les personas, dans l’historique de chaque skill pour les bundles. La lecture compagne est [Journaux d’audit](/fr/platform/admin/governance/audit-logs) pour le qui-a-fait-quoi à travers les trois.
