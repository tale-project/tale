---
title: Choisir comment créer une automatisation
description: Modifie directement le workflow dans l’éditeur visuel ou laisse ton agent de code modifier les automatisations par l’endpoint MCP de Tale.
---

Modifie une automatisation sur son canevas, ou laisse ton agent de code la modifier par l’endpoint MCP de Tale. L’éditeur n’a pas d’assistant IA intégré : pour travailler sur tes automatisations avec l’IA, tu passes par un agent de code comme Claude Code ou Codex, connecté avec ta clé API. Les deux chemins enregistrent des versions du même workflow et suivent les mêmes règles de validation et de déploiement. Créer des automatisations et les mettre en service demande le rôle Propriétaire, Admin ou Développeur.

## Modifier le workflow dans l’éditeur visuel

Ouvre **Automatisations** et sélectionne le workflow. Choisis un nœud pour examiner ses entrées, son modèle, son code ou ses autres réglages. Enregistre la modification avec un message de version, lance un test, puis déploie la version souhaitée lorsque ses vérifications passent.

<Frame caption="Le nœud sélectionné affiche sa configuration à côté du graphe.">

![L’éditeur d’automatisation montre le graphe du workflow et les champs d’entrée du nœud sélectionné dans un panneau latéral.](/images/platform/automation-editor-canvas.webp)

</Frame>

[L’éditeur de workflow](/fr/platform/automations/editor) détaille ces étapes, l’examen d’une exécution et le retour à une version antérieure. Le canevas n’inclut pas de panneau d’assistant conversationnel.

## Utiliser un assistant externe avec MCP

Connecte ton agent de code avec l’endpoint indiqué sous **Paramètres > API > MCP** et ta clé API personnelle ; [Utiliser Tale depuis ton éditeur ou un script](/fr/develop/use-tale-from-your-editor) propose des configurations prêtes à l’emploi. Dis-lui ce que l’automatisation doit recevoir, ce qu’elle doit produire et quels systèmes elle peut modifier. Demande-lui d’examiner les automatisations existantes et ce dont ton organisation dispose avant d’en créer une autre.

Ton agent travaille sur une automatisation comme toi dans l’éditeur. Il lit la référence et la version actuelle, valide sa modification, l’exécute avec les simulations et lance les tests de l’automatisation, puis enregistre une nouvelle version en indiquant celle dont il est parti. Si quelqu’un a enregistré une version plus récente entre-temps, Tale refuse l’enregistrement ; l’agent lit alors cette version et y intègre d’abord sa modification. Quand il lance une version enregistrée avec les simulations, l’exécution apparaît dans l’onglet **Exécutions** de l’automatisation comme exécution **Essai**, **Lancée par toi (API)**, pour que tu puisses ouvrir ce qu’il a exécuté.

Enregistrer crée une version sans la mettre en service. Avant que ton agent mette en service, supprime, définisse un déclencheur ou installe une automatisation dans des projets, un client qui respecte le marquage de Tale pour ces outils, comme Claude Code, te demande ton accord, même si tu laisses l’agent lancer d’autres outils sans demander. Examine la version et ses résultats de test avant d’accepter. Chaque modification de ton agent figure dans le [journal d’audit](/fr/platform/admin/governance/audit-logs) avec **Source** Agent de code, et l’[endpoint MCP](/fr/develop/mcp-endpoint) liste chaque outil qu’il peut utiliser.

## Distinguer les décisions pendant l’exécution

Un nœud agent accomplit du travail pendant une exécution. Il est distinct de l’agent de code qui t’aide à écrire le workflow. De même, une [approbation](/fr/platform/approvals/concepts) autorise une opération en attente pendant l’exécution ; elle ne valide pas une modification proposée de la définition. Ton agent de code ne décide jamais d’une approbation : si une exécution qu’il lance en demande une, elle attend qu’une personne décide dans Tale.

Choisis [l’éditeur](/fr/platform/automations/editor) pour une modification directe ou [MCP](/fr/develop/mcp-endpoint) pour travailler depuis ton client. Pars d’[une automatisation existante](/fr/platform/automations/catalog) lorsqu’une solution adaptée est déjà disponible.
