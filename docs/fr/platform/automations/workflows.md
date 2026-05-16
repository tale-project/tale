---
title: Automatisations
description: Construis, configure et teste des automatisations dans l'éditeur visuel.
---

L'éditeur d'automatisations, c'est l'endroit où le vocabulaire des [Concepts des automatisations](/fr/platform/automations/concepts) devient un graphe exécutable. Cette page couvre le flux de construction lui-même : ouvrir l'éditeur, les six types d'étapes, les boutons de configuration qui façonnent reprises et délais, les variables que chaque étape peut lire et le chemin **Tester l'automatisation** qui valide un brouillon avant la mise en ligne. Le public, c'est le Développeur ou plus qui construit ou maintient une automatisation ; les surfaces des déclencheurs et des exécutions ont leurs propres pages, liées en bas.

## Ouvrir l'éditeur

Ouvre **Automatisations** dans la barre latérale et clique **Créer une automatisation**. La boîte de dialogue a deux onglets : **Vierge** te laisse décrire ce que l'automatisation doit faire dans un seul champ, et l'assistant IA transforme cette description en un premier brouillon d'étapes que tu raffines dans l'éditeur. **À partir d'un modèle** liste les automatisations prêtes à l'emploi livrées avec les intégrations installées — choisis-en une, donne-lui un nom, et l'éditeur s'ouvre avec les étapes du modèle déjà câblées.

L'éditeur lui-même est un canevas. Les étapes sont des nœuds, les liens entre elles sont orientés, et le panneau de droite ouvre ce qui est sélectionné. La barre d'outils en haut du canevas porte **Ajouter une étape**, **Tester l'automatisation**, **Assistant IA** et **Focus** (replie le canevas sur une seule colonne pour un plus petit écran).

## Types d'étapes

Six types d'étapes couvrent le travail qu'une automatisation peut accomplir. Choisis selon ce que l'étape doit faire.

| Étape         | À utiliser pour                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| **Début**     | Le point d'entrée. Nomme le schéma d'entrée et lie les déclencheurs.                                  |
| **Action**    | Appeler une opération d'intégration, un outil MCP ou une action native Tale.                          |
| **LLM**       | Envoyer un prompt à un modèle et router la réponse vers la suite.                                     |
| **Condition** | Bifurquer vers un chemin parmi plusieurs selon une vérification sur la sortie d'une étape précédente. |
| **Boucle**    | Répéter un bloc d'étapes une fois par élément d'une liste.                                            |
| **Sortie**    | Nommer les données que l'automatisation renvoie quand elle se termine.                                |

Chaque étape atterrit sur le canevas avec des valeurs par défaut sensées ; tu la configures en cliquant dessus et en éditant dans le panneau de droite. Le panneau valide à la frappe et marque les champs manquants par une erreur en ligne, plutôt que de laisser l'automatisation s'enregistrer dans un état cassé.

## Configuration

Ouvre l'onglet **Configuration** de n'importe quelle automatisation pour régler les boutons qui s'appliquent à toute l'exécution, pas à une étape.

| Champ                           | Défaut      | Ce qu'il fait                                                                                            |
| ------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| **Nom**                         | —           | Le nom affiché partout dans la plateforme. Obligatoire.                                                  |
| **Description**                 | —           | Description en texte libre, remontée dans les sélecteurs et les métriques.                               |
| **Délai d'expiration (ms)**     | 300 000     | Combien de temps l'automatisation peut tourner avant que le moteur ne l'arrête. Cinq minutes par défaut. |
| **Nombre max de tentatives**    | 3           | Nombre de reprises par étape quand une étape échoue avec une erreur passagère.                           |
| **Délai entre tentatives (ms)** | 1 000       | Délai entre tentatives. Double à chaque essai jusqu'à une borne raisonnable.                             |
| **Variables**                   | `{}` (JSON) | Sac partagé clé-valeur lu par chaque étape via `{{ variables.<key> }}`. Édite comme un objet JSON.       |

Le bouton **Enregistrer la configuration** écrit la modification. Les modifications enregistrées s'appliquent à la prochaine exécution — les exécutions en cours gardent la configuration avec laquelle elles ont démarré.

## Variables

Le champ **Variables** est un objet JSON. Tout ce que tu y mets se lit depuis chaque configuration d'étape avec la syntaxe `{{ variables.<key> }}`. Les deux formes courantes, ce sont les identifiants référencés par plusieurs étapes et les drapeaux de fonctionnalité qui font varier le comportement entre brouillons et version en ligne. Deux points à garder en tête : les valeurs secrètes stockées en variables ne sont pas chiffrées à part — pour les identifiants qu'un connecteur lit, passe plutôt par la surface d'identifiants de l'intégration ; et les variables sont versionnées avec le reste de l'automatisation, donc une restauration depuis **Historique** les ramène avec les étapes.

## Tester l'automatisation

Clique **Tester l'automatisation** dans la barre d'outils pour faire tourner le brouillon avec une charge utile d'entrée de ton choix. Le test tourne sur le même moteur que les exécutions de production, mais il est enregistré sur l'onglet **Exécutions** avec la source de déclenchement étiquetée `manual` — tu peux donc le rejouer, comparer sa sortie à une exécution précédente et réutiliser son entrée plus tard. Utilise-le avant de publier — un brouillon publié commence à se déclencher sur ses vrais déclencheurs immédiatement, et cinq secondes de test valent mieux qu'un appel à 3 h du matin pour une étape **Action** mal configurée.

## Historique

Chaque édition enregistrée atterrit dans **Historique**, à côté du canevas principal de l'éditeur. Le bouton **Restaurer** rembobine l'automatisation jusqu'au cliché choisi ; la vue **Comparer les modifications** montre le diff avant que tu ne valides la restauration. L'historique, c'est le filet de sécurité pour « le changement que j'ai livré ce matin a cassé l'exécution nocturne » — ouvre-le, trouve le cliché précédent, restaure.

## Construis-en une

L'éditeur est volontairement directif : chaque étape fait un mouvement, le graphe va de **Début** à **Sortie**, et **Tester l'automatisation** valide la forme avant publication. Les deux pages suivantes couvrent les morceaux du modèle que l'éditeur ne fait que pointer — [Déclencheurs](/fr/platform/automations/triggers) pour les quatre façons dont une automatisation démarre, et [journaux d'exécution](/fr/platform/automations/execution-logs) pour la trace par exécution qu'on lit quand quelque chose échoue.
