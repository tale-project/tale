---
title: Choisir comment créer une automatisation
description: Modifie directement le workflow dans l’éditeur visuel ou connecte un assistant externe à Tale avec MCP.
---

Modifie une automatisation sur son canevas ou connecte un assistant externe avec MCP pour utiliser les outils de Tale. Les deux chemins enregistrent des versions du même workflow et suivent les mêmes règles de validation et de déploiement. Il te faut les droits Développeur pour créer et déployer des automatisations.

## Modifier le workflow dans l’éditeur visuel

Ouvre **Automatisations** et sélectionne le workflow. Choisis un nœud pour examiner ses entrées, son modèle, son code ou ses autres réglages. Enregistre la modification avec un message de version, lance un test, puis déploie la version souhaitée lorsque ses vérifications passent.

<Frame caption="Le nœud sélectionné affiche sa configuration à côté du graphe.">

![L’éditeur d’automatisation montre le graphe du workflow et les champs d’entrée du nœud sélectionné dans un panneau latéral.](/images/platform/automation-editor-canvas.webp)

</Frame>

[L’éditeur de workflow](/fr/platform/automations/editor) détaille ces étapes, l’examen d’une exécution et le retour à une version antérieure. Le canevas n’inclut pas de panneau d’assistant conversationnel.

## Utiliser un assistant externe avec MCP

Configure ton client avec le point d’accès indiqué sous **Paramètres > API > MCP** et une clé API adaptée. Décris les entrées, la sortie attendue et les systèmes que le workflow peut modifier. Demande au client d’examiner les automatisations et capacités existantes avant d’en créer une autre.

Le [point d’accès MCP](/fr/develop/mcp-endpoint) propose des outils de documentation, validation, enregistrement, test et déploiement. Examine le workflow obtenu et ses résultats de test avant de le déployer. L’enregistrement crée une version, sans la rendre active.

## Distinguer les décisions pendant l’exécution

Un nœud agent accomplit du travail pendant une exécution. Il est distinct du client qui t’aide à écrire le workflow. De même, une [approbation](/fr/platform/approvals/concepts) autorise une opération en attente pendant l’exécution ; elle ne valide pas une modification proposée de la définition.

Choisis [l’éditeur](/fr/platform/automations/editor) pour une modification directe ou [MCP](/fr/develop/mcp-endpoint) pour travailler depuis ton client. Pars d’[une automatisation existante](/fr/platform/automations/catalog) lorsqu’une solution adaptée est déjà disponible.
