---
title: Amorces de conversation
description: Écrire les prompts suggérés qu’un agent affiche sur son écran de chat vide — les ajouter, les ordonner, les traduire, et l’action de traduction automatique.
---

Une amorce est un court prompt suggéré que l’agent affiche sur un écran de chat vide. Touches-en une et le texte tombe dans la zone de saisie ; l’utilisateur le modifie s’il veut, puis envoie. Les amorces sont les points d’entrée choisis par l’auteur de l’agent vers ce pour quoi l’agent existe — cette page est le côté auteur ; leur rendu côté utilisateur est [Amorces et prompts](/fr/platform/chat/starters-and-prompts).

<Frame caption="L’onglet Amorces — une liste ordonnée de prompts avec les onglets de langue au-dessus.">

![L’onglet Amorces de l’éditeur d’agent montrant quatre amorces de conversation en anglais avec leurs poignées de glissement, leurs flèches de réordonnancement et leurs boutons de suppression.](/images/platform/agent-editor-starters.webp)

</Frame>

## Ajouter et ordonner les amorces

Ouvre l’agent et passe à l’onglet **Amorces**. Chaque amorce est un prompt d’au plus 200 caractères ; **Ajouter une amorce** ajoute une ligne, jusqu’à quatre par agent — laisse la liste vide pour n’afficher aucune suggestion. L’ordre compte parce que c’est l’ordre que voient les utilisateurs : glisse la poignée d’une ligne ou utilise les flèches pour la déplacer, et retire-en une avec le × de sa ligne. Clique sur **Enregistrer** — les amorces voyagent avec la configuration de l’agent comme n’importe quel autre réglage.

Écris les amorces comme un utilisateur poserait vraiment sa question : concret, à la première personne, dans le domaine de l’agent. Quatre prompts vagues se lisent moins bien que deux prompts nets.

## Les traduire

Chaque amorce a une version par défaut (l’onglet marqué **par défaut**) et une traduction optionnelle par langue. Un onglet de langue auquel il manque encore sa version est signalé **non traduit**, et les utilisateurs de cette langue voient le texte par défaut. Passe sur un onglet de langue pour saisir les traductions à la main — les traductions recouvrent les lignes existantes ; la liste elle-même (nombre et ordre) appartient à la langue par défaut.

**Traduction automatique** sur un onglet de langue remplit les versions manquantes en une étape. Les résultats s’enregistrent comme des chaînes ordinaires, modifiables, donc ajuste-les ensuite là où la tournure machinale manque ta voix ; si la traduction échoue, un toast le dit et les valeurs par défaut restent en place.

## Où ça se situe

Les amorces de conversation sont la plus petite surface de la zone des agents — quelques phrases chacune, mais elles décident si l’écran de chat vide a l’air engageant ou nu. La page à coupler avec celle-ci est [Amorces et prompts](/fr/platform/chat/starters-and-prompts), qui montre leur rendu côté utilisateur ; le reste du comportement de l’agent vit dans [Concepts d’agent](/fr/platform/agents/concepts).
