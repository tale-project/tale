---
title: Choisir comment créer une automatisation
description: Modifie directement le workflow dans l’éditeur visuel ou laisse ton agent de code modifier les automatisations par l’endpoint MCP de Tale.
---

Modifie les champs d’une automatisation directement dans l’éditeur, ou laisse ton agent de code la créer et la modifier par l’endpoint MCP de Tale. L’éditeur n’a pas d’assistant IA intégré : pour travailler sur tes automatisations avec l’IA, tu passes par un agent de code comme Claude Code ou Codex, que tu connectes depuis l’agent lui-même ou avec ta clé API. Les deux chemins enregistrent des versions du même workflow et suivent les mêmes règles de validation et de déploiement. Créer des automatisations et les mettre en service demande le rôle Propriétaire, Admin ou Développeur.

## Modifier le workflow dans l’éditeur

Ouvre **Automatisations** et sélectionne le workflow. Choisis un nœud pour examiner son entrée, son modèle, son code ou ses autres réglages, et modifie le champ voulu. Enregistre la modification avec un message de version, lance un test, puis déploie la version souhaitée lorsque ses vérifications passent. Le canevas se dispose lui-même à partir des références entre les nœuds ; tu n’y ajoutes pas de nœuds et n’y traces pas de liaisons.

<Frame caption="Le nœud sélectionné affiche sa configuration à côté du graphe.">

![L’éditeur d’automatisation montre le workflow entre Début et Fin et les champs du nœud sélectionné dans un panneau latéral.](/images/platform/automation-editor-canvas.webp)

</Frame>

[L’éditeur de workflow](/fr/platform/automations/editor) détaille ces étapes, la lecture du canevas, l’examen d’une exécution et le retour à une version antérieure. Le canevas n’inclut pas de panneau d’assistant conversationnel.

## Modifier avec ton agent de code

Le point de départ est **Modifier avec ton agent de code**, le dernier bouton en haut à droite du canevas de l’éditeur. Son dialogue donne les commandes qui connectent Claude Code ou Codex et l’adresse pour tout autre agent, indique quand ton agent s’est connecté et te propose un prompt à lui donner, qui nomme cette automatisation. L’agent se connecte lui-même, et tu choisis l’organisation et ce qu’il peut faire ; si ton opérateur a désactivé la connexion des agents, le dialogue montre le nom de l’automatisation et mène à **Paramètres > API > MCP**, où tu donnes à l’agent ta clé API personnelle. [Utiliser Tale depuis ton éditeur ou un script](/fr/develop/use-tale-from-your-editor) propose des configurations prêtes à l’emploi, et [Agents connectés](/fr/platform/admin/connected-agents) montre les agents que tu as connectés et te laisse mettre fin à leur connexion. Dis à ton agent ce que l’automatisation doit recevoir, ce qu’elle doit produire et quels systèmes elle peut modifier. Demande-lui d’examiner les automatisations existantes et ce dont ton organisation dispose avant d’en créer une autre. Une exécution en échec offre le même accès : **Corriger avec ton agent de code**, sur la [carte d’échec](/fr/platform/automations/execution-logs#failures), confie cette exécution à ton agent. Pour démarrer une nouvelle automatisation de la même façon, choisis **Créer une automatisation** › **Avec ton agent de code** dans la liste ; l’agent la construit et enregistre sa première version.

Ton agent travaille sur une automatisation comme toi dans l’éditeur. Il lit la référence et la version actuelle, valide sa modification, l’exécute avec les simulations et lance les tests de l’automatisation, puis enregistre une nouvelle version en indiquant celle dont il est parti. Si quelqu’un a enregistré une version plus récente entre-temps, Tale refuse l’enregistrement ; l’agent lit alors cette version et y intègre d’abord sa modification. Quand il lance une version enregistrée avec les simulations, l’exécution apparaît dans l’onglet **Exécutions** de l’automatisation comme exécution **Essai**, **Lancée par toi (API)**, pour que tu puisses ouvrir ce qu’il a exécuté. Une version enregistrée par l’agent apparaît sur le canevas pendant que tu consultes l’automatisation.

Enregistrer crée une version sans la mettre en service. Avant que ton agent mette en service, supprime, définisse un déclencheur ou installe une automatisation dans des projets, un client qui respecte le marquage de Tale pour ces outils, comme Claude Code, te demande ton accord, même si tu laisses l’agent lancer d’autres outils sans demander. Examine la version et ses résultats de test avant d’accepter. Chaque modification de ton agent figure dans le [journal d’audit](/fr/platform/admin/governance/audit-logs) avec **Source** Agent de code, et l’[endpoint MCP](/fr/develop/mcp-endpoint) liste chaque outil qu’il peut utiliser.

## Distinguer les décisions pendant l’exécution

Un nœud agent accomplit du travail pendant une exécution. Il est distinct de l’agent de code qui t’aide à écrire le workflow. De même, une [approbation](/fr/platform/approvals/concepts) autorise une opération en attente pendant l’exécution ; elle ne valide pas une modification proposée de la définition. Ton agent de code ne décide jamais d’une approbation : si une exécution qu’il lance en demande une, elle attend qu’une personne décide dans Tale.

Choisis [l’éditeur](/fr/platform/automations/editor) pour une modification directe ou [MCP](/fr/develop/mcp-endpoint) pour travailler avec ton agent de code. Pars d’[une automatisation existante](/fr/platform/automations/catalog) lorsqu’une solution adaptée est déjà disponible.
