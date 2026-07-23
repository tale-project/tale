---
title: Parcourir et installer des automatisations
description: Comment fonctionne le catalogue des automatisations — Installées vs Toutes les automatisations, le panneau latéral qu’ouvre une carte, l’assistant d’installation et son contrôle préalable, réinstaller et désinstaller, et mettre à jour toutes les automatisations livrées en une fois.
---

Le catalogue des automatisations (**Automatisations** dans la barre latérale) est l’endroit où les Propriétaires, Admins et Développeurs parcourent chaque automatisation disponible pour l’organisation et décident lesquelles installer. Cette page couvre le catalogue lui-même — le panneau latéral qu’ouvre une carte, l’assistant d’installation, et les actions de réinstallation, désinstallation et mise à jour qui suivent. Ce que fait chaque automatisation livrée vit sur [Automatisations livrées](/fr/platform/automations/builtin) ; le modèle mental des pièces qu’une automatisation empaquette vit sur [Concepts d’automatisation](/fr/platform/automations/concepts).

<Frame caption="Le catalogue des automatisations — chaque carte est une automatisation installable ; le bundle installe tous ses membres via un seul assistant.">

![Le catalogue des automatisations sur l’onglet Toutes les automatisations, avec les cartes des trois automatisations d’e-mail et du bundle Résoudre les issues GitHub, chacune avec son icône et sa description.](/images/platform/automations-catalog.webp)

</Frame>

## Installées et Toutes les automatisations

Le catalogue s’ouvre sur **Installées** — le choix par défaut de la barre d’onglets, et le seul onglet où un bundle se dissout en ses propres cartes membres au lieu d’apparaître une fois comme bundle. Chaque membre porte sur son icône un petit repère nommant son bundle — **Partie de Résoudre les issues GitHub**, par exemple — pour que leur appartenance reste visible même séparés, et chacun garde son propre **Réinstaller**/**Désinstaller** dans son menu **⋯** : un bundle n’a pas d’installation propre à gérer comme un tout (voir [Concepts d’automatisation](/fr/platform/automations/concepts) pour comprendre pourquoi). Passe à **Toutes les automatisations** pour parcourir tout le catalogue à la place — livrées et téléversées, installées ou non : ici, le bundle EST la carte, installée via un seul assistant, et ses membres cachés n’apparaissent jamais seuls. **Installées** sert à gérer ce qui tourne ; **Toutes les automatisations** à trouver du nouveau.

## Installer une automatisation

Clique sur une carte et son panneau latéral s’ouvre — le même mode aperçu-au-clic que [Paramètres > Intégrations](/fr/platform/integrations/overview) utilise pour son propre catalogue. Le panneau liste ce que l’installation ajoute : ses pages, workflows, agents, compétences, et les intégrations qu’elle requiert, plus le projet qu’elle cible si elle est scopée à un projet. Clique sur **Installer** et l’assistant s’ouvre.

L’assistant ne parcourt que les étapes dont cette automatisation a réellement besoin : une étape **Projet** si elle est scopée à un projet et que tu ne l’as pas ouverte depuis l’intérieur d’un projet ; une étape **Vérifier les changements** si l’installation écraserait des fichiers déjà sur le disque ; une étape **Installer** qui connecte toute intégration requise pas encore connectée ; une étape **Mode de l’agent** pour chaque agent qui peut tourner sur tes propres identifiants plutôt que sur ceux de la plateforme ; et une étape **Terminé**. Le projet que tu choisis à l’étape **Projet** fait double usage : c’est aussi ce à quoi est liée chaque planification installée par l’automatisation, pour qu’une automatisation dont le document lit `{{ input.projectId }}` s’exécute contre le bon projet sans que cette valeur soit retapée nulle part.

**Terminé** n’annonce « prête » que lorsque l’automatisation l’est vraiment. Si chaque intégration requise est connectée, c’est exactement ce qui s’affiche ; une entrée requise que le schéma propre à l’automatisation déclare et qu’aucune étape de l’assistant ne demande est nommée à la place, si bien que tu quittes l’assistant en sachant ce qui manque encore (pour un bundle, l’étape Terminé fait la même chose par membre). Chaque étape de configuration reste rattrapable plus tard, depuis la checklist **Terminer la configuration** propre à l’automatisation.

## Le contrôle préalable à l’installation

Réinstaller ou téléverser à nouveau par-dessus une automatisation dont certains fichiers ont déjà changé déclenche une étape **Vérifier les changements** avant que quoi que ce soit ne soit touché. Pour une automatisation seule, l’étape liste chaque fichier que l’installation écraserait et te demande de confirmer le remplacement de tous par les versions de l’automatisation — pas de sélection fichier par fichier. Installer un **bundle** passe en revue chaque automatisation membre séparément : chacune a sa propre section repliable et sa propre confirmation, pour que tu voies exactement lesquelles des plusieurs automatisations du bundle touchent des fichiers que tu as modifiés. Dans les deux cas, le document de workflow propre à une automatisation échappe à ce contrôle — voir la section suivante.

## Réinstaller, désinstaller et mettre à jour

Chaque carte installée porte un menu **⋯** avec **Réinstaller** et **Désinstaller** ; le menu d’une carte pas encore installée propose **Installer** à la place, plus **Supprimer** pour un envoi privé que tu n’as pas encore installé. **Réinstaller** relance le même contrôle préalable qu’une installation neuve et conserve tes variables d’environnement et tes secrets. **Désinstaller** retire l’automatisation et tout ce qu’elle a installé — ses agents, workflows, pages, et leurs variables d’environnement et secrets — tandis que toute intégration qu’elle utilisait reste connectée pour ce que d’autres en font.

Réinstaller ne touche jamais au document de workflow de l’automatisation : il est exempté de mise à jour, donc les versions que tu as enregistrées et celle que tu as mise en service survivent à chaque réinstallation et à chaque mise à jour du catalogue. Pour récupérer plutôt le dernier document livré, désinstalle l’automatisation puis réinstalle-la — Tale répète ce rappel sur la confirmation de réinstallation.

**Mettre à jour les automatisations livrées**, dans le même menu **Ajouter une automatisation** que **Téléverser un package**, est une action différente des deux précédentes : elle resynchronise en un seul passage toutes les automatisations livrées de l’organisation avec le catalogue livré — y compris celles que tu as modifiées — plutôt qu’une carte à la fois. Elle porte la même exemption de workflow et conserve les secrets, et comme un enregistrement ne fait qu’ajouter, ce qu’elle change laisse chaque version antérieure de cette automatisation exactement où elle était.

## Téléverser une automatisation privée

**Téléverser un package**, dans le même menu, ajoute une automatisation que le catalogue ne livre pas — dépose un `.zip`, ou sélectionne un dossier contenant un `automation.json` à sa racine ; le nom du dossier ou du fichier devient le slug de l’automatisation. Téléverser ne fait que l’ajouter au catalogue privé de l’organisation ; installe-la ensuite comme n’importe quelle autre carte. Téléverser à nouveau par-dessus un slug qui existe déjà te demande de confirmer le remplacement avant d’écraser le package existant.

## Où cela s’inscrit

Le catalogue est la porte d’entrée vers chaque automatisation que l’organisation peut faire tourner : le panneau latéral prévisualise ce que l’installation ajoute, l’assistant connecte ce dont elle a besoin, et réinstaller, désinstaller et mettre à jour la gardent à jour sans toucher à un workflow que tu es en train de modifier. [Automatisations livrées](/fr/platform/automations/builtin) est la lecture suivante pour ce que fait chaque automatisation livrée et le bundle Résoudre les issues GitHub ; [Concepts d’automatisation](/fr/platform/automations/concepts) est le modèle mental si tu ne l’as pas encore lu.
