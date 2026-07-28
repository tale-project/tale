---
title: Configurer les approbations
description: Là où les exigences d’approbation sont déclarées — par opération d’intégration, par outil MCP, et intégrées d’office pour les écritures et les changements de workflow — et où lire ce qui demandera avant de s’exécuter.
---

Les exigences d’approbation dans Tale sont déclaratives : chaque capacité porte son propre drapeau disant si un agent doit d’abord demander, et le drapeau voyage avec l’intégration ou le serveur qui fournit la capacité. Rien n’est à configurer pour que les valeurs par défaut soient justes — cette page montre où vit chaque drapeau, quelles écritures demandent d’elles-mêmes et comment changer cela pour ton organisation.

Le modèle de ce qu’est une carte d’approbation et de qui la décide vit sur [Concepts d’approbation](/fr/platform/approvals/concepts). Ce qui suit est la surface de configuration, capacité par capacité.

## Opérations d’intégration

Chaque intégration déclare ses opérations, et chaque opération porte son propre drapeau d’approbation. Ouvre **Paramètres > Intégrations**, clique sur une intégration, et sa liste d’opérations badge celles marquées **Nécessite une approbation** — pour les connecteurs livrés, c’est le versant écriture : envoyer du courrier, poster des messages, créer des tickets. Les lectures s’exécutent sans carte ; les écritures marquées tiennent dans le chat avec leurs paramètres exacts jusqu’à ce que quelqu’un approuve.

Le drapeau n’est pas un réglage séparé qu’un administrateur bascule. Chaque action déclarée par un connecteur porte un effet — `read` ou `write` — et c’est le versant écriture que la politique d’approbation retient. Cela garde les deux honnêtes l’un envers l’autre : une action ne peut pas passer discrètement d’une lecture à une écriture sans changer aussi ce pour quoi elle doit demander.

## Quelles écritures demandent

Une carte mérite l’attention de quelqu’un quand l’écriture **quitte ton locataire**. C’est là que passe la ligne par défaut :

- **Les écritures vers des systèmes externes demandent** — envoyer du courrier, poster dans Slack, ouvrir un ticket GitHub, écrire sur un partage WebDAV. Ces connecteurs détiennent tes identifiants et agissent sur des systèmes qui n’appartiennent pas à Tale.
- **Les écritures sur la surface de Tale ne demandent pas** — déplacer une tâche, la commenter, déposer un document dans le projet, lancer un script dans ton propre bac à sable. Elles sont déjà bornées par les droits de qui les exécute, l’automatisation qui les effectue a passé son gate de déploiement, et chacune figure dans la trace de l’exécution et dans le journal d’audit.

Sans cette ligne, une seule exécution empile une demi-douzaine de cartes pour sa propre comptabilité — « passer cette carte à En cours » — et enterre la seule carte qui demandait vraiment un humain.

## Déplacer la ligne pour ton organisation

Les deux directions se configurent par organisation, dans `governance/approval-policy.yml` sous ton répertoire de configuration. Chaque règle nomme **une** cible — un connecteur entier, ou une action précise sous la forme `<connecteur>.<action>` — et la règle la plus spécifique gagne :

```yaml
rules:
  # Cette équipe relit chaque tâche que le desk touche.
  - connector: task
    decision: require_approval
  # Le mail de rapport nocturne est de confiance ; les autres actions mail demandent toujours.
  - action: imap-smtp.send
    decision: auto_approve
```

Une opération déjà en attente sur une carte garde sa carte même si la politique est assouplie ensuite — une décision appartient à l’opération pour laquelle elle a été demandée, et une exécution en pause n’est donc jamais laissée en plan.

## Outils MCP

Le manifeste d’un serveur MCP marque lesquels de ses outils exigent un accord. Ouvre **Paramètres > API > MCP**, déplie un serveur, et sa liste **Outils découverts** badge chaque outil marqué avec **Nécessite une approbation** — ceux-là demandent dans le chat chaque fois qu’un agent les appelle. Le drapeau vient de l’auteur du serveur ; connecter un serveur, c’est accepter son contrat d’outils, donc relis la liste avant d’en activer un. [Serveurs MCP](/fr/platform/integrations/mcp-servers) couvre l’enregistrement.

## Garde-fous d’écriture intégrés

Certaines portes sont livrées actives et ne se configurent pas, parce que l’action est lourde de conséquences par nature :

- **Écritures de documents** — un agent qui enregistre des fichiers dans le hub documentaire demande toujours (**Enregistrer dans les documents**).
- **Écritures de connaissances** — un agent qui stocke un fait à l’échelle de l’org demande toujours (**Enregistrer dans la base de connaissances**).
- **Création, mises à jour et exécutions de workflows** — un agent qui construit, modifie ou démarre un workflow demande toujours ; voir [Approbations dans les workflows](/fr/platform/automations/approvals-in-workflows).

<Note>

Le levier pour celles-ci n’est pas le drapeau d’approbation mais la capacité elle-même : un agent sans les outils de documents ou de workflows ne produit jamais la carte. Taille le [jeu d’outils](/fr/platform/agents/tools) de l’agent pour retirer la capacité entièrement.

</Note>

## Vérifier ce qui demandera

Avant de mettre un agent devant de vrais systèmes, lis ses capacités comme le ferait un approbateur : la liste d’opérations de l’intégration pour les écritures marquées, les **Outils découverts** du serveur MCP pour les outils marqués, et l’onglet outils de l’agent pour savoir s’il tient des outils d’écriture tout court. Le [journal d’audit](/fr/platform/admin/governance/audit-logs) enregistre ensuite chaque décision que produit l’installation.

## Où cela s’inscrit

Configurer ici, c’est distribuer — les drapeaux vivent avec les intégrations et les serveurs qui possèdent les capacités. Lis [Concepts d’approbation](/fr/platform/approvals/concepts) pour le cycle de vie de carte que ces drapeaux produisent, et [Outils d’agent](/fr/platform/agents/tools) pour le versant capacité de la même frontière.
