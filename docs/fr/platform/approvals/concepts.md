---
title: Comprendre les approbations d’actions
description: Comprends pourquoi une écriture via un Connector attend, ce qu’autorise une approbation et où vérifier le résultat.
---

Une approbation te permet de vérifier une écriture prévue via un Connector avant son exécution. Une automatisation peut, par exemple, préparer un e-mail puis attendre que tu vérifies le destinataire et le contenu avant l’envoi.

## Quand une écriture attend

Une exécution réelle se met en pause lorsqu’elle atteint une écriture via un Connector que la politique de l’organisation soumet à approbation. Par défaut, les écritures vers des systèmes externes demandent une approbation ; celles qui passent par des Connectors internes authentifiés par la plateforme n’en demandent pas. L’organisation peut modifier cette règle pour un Connector ou une action précise. Consulte [Configurer les approbations](/fr/platform/approvals/configure).

Les lectures ne demandent pas d’approbation. **Essai** utilise des Connectors simulés : il n’effectue pas l’écriture externe et n’affiche pas sa carte d’approbation réelle. Un test réussi ne prouve pas que l’action prévue convient à la situation.

## Vérifier l’action prévue

Ouvre la [liste des exécutions](/fr/platform/automations/execution-logs) de l’automatisation, puis celle au statut **En attente**. La carte d’approbation nomme l’action, par exemple `imap-smtp.send`, et le nœud qui la demande. **L'étape appellerait avec** montre les entrées exactes.

Compare la destination, les destinataires, le contenu et les identifiants à la tâche prévue. Vérifie aussi les informations sensibles dans les entrées avant de choisir :

- **Approuver** autorise cette action lorsque l’exécution reprend.
- **Rejeter** empêche l’action et fait échouer l’étape ainsi que l’exécution.

La carte ne permet pas de modifier l’action. Si une entrée est incorrecte, rejette la demande, corrige le workflow ou ses entrées, puis lance une nouvelle exécution.

<Note>

Les membres de l’organisation peuvent décider des approbations d’actions de Connector. Ces cartes ne sont pas attribuées à une personne ou à un groupe de validation précis : la décision se prend dans le détail de l’exécution. D’autres types de validation peuvent exiger des droits plus stricts.

</Note>

## Vérifier le résultat

L’approbation autorise l’exécution ; elle ne garantit pas que le Connector réussira. Vérifie ensuite le statut, le résultat du nœud et les effets produits. Une exécution rejetée indique le refus comme cause de l’échec. Le [journal d’audit](/fr/platform/admin/governance/audit-logs) conserve la décision et son auteur.

Une approbation en attente reste ouverte si la politique est assouplie. La même action dans la même exécution conserve sa décision ; une nouvelle exécution est évaluée à nouveau. Une exécution terminée ou annulée ne peut plus utiliser une approbation encore ouverte pour effectuer son écriture.

## Distinguer une approbation d’une question

Un nœud agent peut aussi se mettre en pause parce qu’il lui manque une information. Ta réponse fournit une entrée ; elle n’approuve pas une écriture via un Connector. [Approbations dans les workflows](/fr/platform/automations/approvals-in-workflows) explique les deux interactions. Les validations de tâches, de documents contrôlés et de demandes d’effacement ont leurs propres [règles de validation](/fr/platform/approvals/configure).
