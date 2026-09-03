---
title: Configurer les approbations
description: Là où les exigences d’approbation sont déclarées — par opération de connector, avec un fichier de politique par organisation qui déplace la ligne — et quelles portes humaines se tiennent hors de cette politique.
---

Les exigences d’approbation dans Tale sont déclaratives : chaque capacité porte son propre drapeau disant si une exécution doit d’abord demander, et le drapeau voyage avec l’connector qui fournit la capacité. Rien n’est à configurer pour que les valeurs par défaut soient justes — cette page montre où vit chaque drapeau, quelles écritures demandent d’elles-mêmes et comment changer cela pour ton organisation.

Le modèle de ce qu’est une carte d’approbation et de qui la décide vit sur [Concepts d’approbation](/fr/platform/approvals/concepts). Ce qui suit est la surface de configuration, capacité par capacité.

## Opérations d’connector

Chaque connector déclare ses opérations, et chaque opération porte son propre drapeau d’approbation — pour les connecteurs livrés, c’est le versant écriture : envoyer du courrier, poster des messages, créer des tickets. Les lectures s’exécutent sans carte ; une écriture marquée met l’exécution d’automatisation en pause, et la page de détail de l’exécution montre l’opération avec ses paramètres exacts jusqu’à ce que quelqu’un décide.

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

Les serveurs MCP externes — et les drapeaux d’approbation par outil que leurs manifestes portaient — ne font pas partie de cette version : il n’y a aucun serveur à connecter ni aucune liste d’outils à relire. La seule surface MCP est l’endpoint entrant sous **Paramètres > API > MCP**, où ton client pilote Tale, et une action de connector invoquée par là suit les mêmes règles d’approbation que partout ailleurs — une action retenue répond par une approbation en attente au lieu de s’exécuter. [Endpoint MCP](/fr/develop/mcp-endpoint) couvre les outils et ce que la clé de chaque rôle peut faire ; [Serveurs MCP](/fr/platform/connectors/mcp-servers) dit ce qui a remplacé le formulaire d’enregistrement.

## Portes hors de cette politique

Trois portes humaines du produit ne relèvent pas de la politique d’approbation et ne se désactivent pas ici, parce que chacune a sa propre entrée :

- **Travail d’agent en revue** — un agent de projet ne termine jamais une tâche ; son résultat se met en pause à **En revue** jusqu’à ce qu’une personne l’accepte, et [Automatisation des tâches](/fr/platform/projects/task-automation) couvre qui peut le valider.
- **Documents contrôlés** — un fichier marqué comme contrôlé suit un cycle de soumission, de relecture et d’approbation avec un relecteur nommé ; [Documents](/fr/platform/knowledge/documents) le couvre.
- **Demandes d’effacement** — un effacement RGPD exige l’approbation d’un second Admin avant que la cascade s’exécute ; [Demandes des personnes concernées](/fr/platform/admin/governance/data-subject-requests) la couvre.

<Note>

L’assistant de chat ne produit aucune approbation d’aucune sorte : ses outils sont en lecture seule, il n’y a donc ni carte d’écriture de document, ni carte d’écriture de connaissances, ni carte de workflow dans un chat. Une exécution qui a besoin d’une réponse plutôt que d’une permission — un nœud agent qui pose une question — est une exécution **En attente**, couverte dans [Approbations dans les workflows](/fr/platform/automations/approvals-in-workflows).

</Note>

## Vérifier ce qui demandera

Avant de mettre une automatisation en service face à de vrais systèmes, lis ses nœuds connector comme le ferait un approbateur : lesquels écrivent, et lesquels ta politique approuve d’office. **Essai** te montre le graphe sans rien toucher — le mode simulation ne demande jamais — et le [journal d’audit](/fr/platform/admin/governance/audit-logs) enregistre ensuite chaque décision que produisent les exécutions réelles.

## Où cela s’inscrit

Configurer ici, c’est distribuer — les drapeaux vivent avec les connectors qui possèdent les capacités, et un fichier de politique par organisation déplace la ligne. Lis [Concepts d’approbation](/fr/platform/approvals/concepts) pour la carte que ces drapeaux produisent, et [Approbations dans les workflows](/fr/platform/automations/approvals-in-workflows) pour l’endroit où l’exécution en pause attend.
