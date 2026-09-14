---
title: Répondre à un workflow en attente
description: Retrouve une exécution en pause, vérifie une écriture prévue ou réponds à l’agent pour permettre la reprise.
---

Une exécution peut attendre une décision avant une écriture via un Connector, ou une information dont l’agent a besoin pour continuer. Ouvre son détail pour savoir quelle réponse fournir. Une exécution en attente n’est pas terminée, même si les nœuds précédents ont réussi.

## Retrouver l’exécution en attente

Ouvre l’automatisation et ses [journaux d’exécution](/fr/platform/automations/execution-logs), puis sélectionne celle au statut **En attente**. Vérifie la version et les entrées pour savoir quelle exécution tu examines.

Une carte d’approbation nomme une action de Connector et montre ses entrées prévues. Une question de l’agent demande plutôt une réponse, sous forme de choix ou de texte. Ce sont deux interactions distinctes : répondre à une question n’approuve pas une écriture ultérieure.

## Approuver ou rejeter une écriture

Lis attentivement l’action et les données sous **L'étape appellerait avec**. Vérifie le destinataire ou la destination, le contenu et les identifiants qui déterminent ce qui sera modifié.

Choisis **Approuver** pour autoriser l’action. L’exécution reprend et tente l’écriture ; vérifie ensuite le résultat du nœud et les effets produits. Choisis **Rejeter** si la demande est incorrecte ou ne doit pas être exécutée. Le refus empêche cette action et fait échouer l’exécution.

Tu ne peux pas modifier les paramètres sur la carte. Rejette une demande incorrecte, corrige le workflow ou ses entrées, puis teste la correction avant une nouvelle exécution réelle. Modifier la politique d’approbation ne libère pas une carte déjà en attente. Consulte les [concepts d’approbation](/fr/platform/approvals/concepts) pour le cycle de décision et la [configuration de la politique](/fr/self-hosted/configuration/approvals) pour les règles d’exploitation.

## Répondre à une question de l’agent

Quand un nœud agent utilise `ask_human`, le détail affiche **L'agent a besoin de ta réponse pour continuer**. S’il propose des choix, réponds aux questions sur la carte. Pour une réponse libre, saisis du texte sous **Ta réponse**, puis choisis **Envoyer la réponse & reprendre**.

Fournis directement l’information manquante. Si l’agent demande quel document utiliser, donne son nom ou son identifiant plutôt qu’une simple instruction de continuer. Le nœud en attente reprend avec ta réponse. L’exécution peut ensuite demander une autre réponse ou une approbation d’action. Les membres de l’organisation peuvent répondre à ces questions.

## Corriger et tester le workflow

Modifier la définition du workflow est une opération distincte de la réponse à son exécution en cours. Enregistre une version corrigée dans l’[éditeur de workflow](/fr/platform/automations/editor), teste-la avec des Connectors simulés, puis mets-la en service lorsqu’elle est prête. Enregistrer une version ne modifie pas un appel qui attend déjà une approbation.

<Frame caption="Modifie le workflow sur le canevas ; examine une exécution en attente dans son détail.">

![L’éditeur de workflow montre le graphe de l’automatisation et un panneau de configuration du nœud sélectionné.](/images/platform/automation-editor-canvas.webp)

</Frame>

Un test avec des Connectors simulés n’effectue pas d’écritures externes et ne demande pas leurs approbations réelles. Pour un exemple complet, suis [Créer un workflow avec approbations](/fr/tutorials/editor/workflow-with-approvals). Après une décision réelle, vérifie le résultat de l’exécution et le [journal d’audit](/fr/platform/admin/governance/audit-logs) : l’autorisation d’agir et la réussite de l’action sont deux résultats différents.
