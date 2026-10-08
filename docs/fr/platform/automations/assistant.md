---
title: Choisir comment créer une automatisation
description: Modifie les champs d’une automatisation dans l’éditeur, ou fais-la créer et modifier par un agent de code via MCP.
---

Modifie les champs d’une automatisation directement dans l’éditeur, ou fais-la créer et modifier par un agent de code comme Claude Code, Codex ou Cursor via MCP. Les deux chemins enregistrent des versions du même workflow et suivent les mêmes règles de validation et de déploiement. Il te faut les droits Développeur pour créer et déployer des automatisations.

## Modifier le workflow dans l’éditeur

Ouvre **Automatisations** et sélectionne le workflow. Choisis un nœud pour examiner son entrée, son modèle, son code ou ses autres réglages, et modifie le champ voulu. Enregistre la modification avec un message de version, lance un test, puis déploie la version souhaitée lorsque ses vérifications passent. Le canevas se dispose lui-même à partir des références entre les nœuds ; tu n’y ajoutes pas de nœuds et n’y traces pas de liaisons.

<Frame caption="Le nœud sélectionné affiche sa configuration à côté du graphe.">

![L’éditeur d’automatisation montre le workflow entre Début et Fin et les champs du nœud sélectionné dans un panneau latéral.](/images/platform/automation-editor-canvas.webp)

</Frame>

[L’éditeur de workflow](/fr/platform/automations/editor) détaille ces étapes, la lecture du canevas, l’examen d’une exécution et le retour à une version antérieure. Le canevas n’inclut pas de panneau d’assistant conversationnel.

## Modifier avec ton agent de code

Le point de départ est **Modifier avec ton agent de code**, le dernier bouton en haut à droite du canevas de l’éditeur. Son dialogue montre le nom de l’automatisation à donner à l’agent, **Configurer MCP**, qui ouvre **Paramètres > API > MCP**, et un lien vers le guide pour connecter un agent de code. Configure ton client avec ce point d’accès et une clé API adaptée. Décris les entrées, la sortie attendue et les systèmes que le workflow peut modifier, et demande à l’agent d’examiner les automatisations et capacités existantes avant d’en créer une autre.

Le [point d’accès MCP](/fr/develop/mcp-endpoint) propose des outils de documentation, validation, enregistrement, test et déploiement. Une version enregistrée par l’agent apparaît sur le canevas pendant que tu consultes l’automatisation. Examine le workflow obtenu et ses résultats de test avant de le déployer. L’enregistrement crée une version, sans la rendre active.

## Distinguer les décisions pendant l’exécution

Un nœud agent accomplit du travail pendant une exécution. Il est distinct de l’agent de code qui t’aide à écrire le workflow. De même, une [approbation](/fr/platform/approvals/concepts) autorise une opération en attente pendant l’exécution ; elle ne valide pas une modification proposée de la définition.

Choisis [l’éditeur](/fr/platform/automations/editor) pour une modification directe ou [MCP](/fr/develop/mcp-endpoint) pour travailler avec ton agent de code. Pars d’[une automatisation existante](/fr/platform/automations/catalog) lorsqu’une solution adaptée est déjà disponible.
