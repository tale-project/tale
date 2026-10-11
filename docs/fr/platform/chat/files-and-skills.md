---
title: Créer des fichiers et utiliser des skills dans le chat
description: Demande à l’assistant un document, un tableur, une présentation, un graphique ou une image, et laisse-le suivre un skill de ta bibliothèque, sans quitter la conversation.
---

L’assistant crée dans la conversation ce que tu lui demandes : un fichier CSV ou Markdown qu’il rédige lui-même, un document Word, un classeur Excel, une présentation PowerPoint, un PDF ou un graphique qu’il produit dans une sandbox légère, et des images si ton organisation le permet. Les fichiers apparaissent sous la réponse, prêts à être ouverts et téléchargés. Les skills de ta [bibliothèque de skills](/fr/platform/workspace/skills) lui indiquent comment bien les réaliser.

## Demander le fichier dont tu as besoin

Indique le format et le contenu dans ton message, comme tu le ferais avec quelqu’un de ton équipe. Par exemple : « Crée un fichier Excel avec notre chiffre d’affaires mensuel 2025 et une ligne de total qui utilise une formule. » Ou : « Transforme ceci en PDF bien mis en page », suivi du texte.

L’assistant choisit la voie la plus légère qui fait l’affaire et ne démarre rien dont il n’a pas besoin :

| Tu demandes | L’assistant | Ce qu’il démarre |
| --- | --- | --- |
| Une réponse, un tableau comparatif, un court bloc de code | Répond directement | Rien |
| Un fichier Markdown, CSV, JSON, HTML ou SVG, une entrée d’agenda (`.ics`) ou une fiche de contact (`.vcf`) | Rédige le fichier lui-même | Rien |
| Une image : une illustration, une scène réaliste, un logo | Génère une image | Le modèle d’images de ton organisation, si la [génération d’images](/fr/platform/admin/governance/content-models#let-agents-generate-images) est activée |
| Un fichier Word, Excel, PowerPoint ou PDF, un graphique, un calcul sur des données, une modification d’un fichier joint | Exécute du code dans une sandbox légère | Une sandbox légère, en une seconde environ |
| Un travail sur un dépôt, dans une session de navigateur ou qui dure des heures | Propose une [tâche de projet](/fr/platform/projects/tasks) | Rien dans le chat ; l’agent de la tâche travaille dans sa propre sandbox |

Pendant qu’il travaille, les étapes au-dessus de la réponse indiquent ce qu’il fait, par exemple **Rédaction de contacts.csv**, **Lecture du skill xlsx** ou **Exécution de Python dans une sandbox légère**. Une étape en échec explique ce qui n’a pas marché, et l’assistant corrige le plus souvent son code avant de réessayer.

## Ouvrir et télécharger les fichiers

Les fichiers apparaissent sous la réponse, dans l’ordre où ils ont été créés. Les images s’affichent directement ; sélectionnes-en une pour l’ouvrir en grand et parcourir les autres. Chaque autre fichier s’affiche sous forme de carte avec son nom, son type et sa taille. Sélectionne la carte pour afficher un aperçu ; les PDF, documents Word, tableurs, fichiers Markdown et fichiers texte s’ouvrent directement. Le bouton de téléchargement à côté de la carte enregistre le fichier sous son propre nom.

<Frame caption="Le fichier rédigé par l’assistant apparaît sous forme de carte sous sa réponse, avec un bouton de téléchargement à côté.">

![Un chat demande les thèmes des retours d’onboarding dans un fichier CSV. Les étapes montrent la rédaction de onboarding-feedback-themes.csv, la réponse indique que le fichier est joint, et une carte en dessous affiche onboarding-feedback-themes.csv, CSV, 251 octets, avec un bouton de téléchargement.](/images/platform/chat-reply-files.webp)

</Frame>

Quand l’assistant retouche un fichier dans la même réponse, par exemple après avoir vérifié son résultat, la carte n’affiche que la version finale. Demande une modification dans un message de suivi pour obtenir une nouvelle version dans la réponse suivante.

Les fichiers appartiennent à la conversation : quiconque peut ouvrir la conversation peut ouvrir ses fichiers.

## Modifier un fichier joint

[Joins le fichier](/fr/platform/chat/attachments) et indique ce qui doit changer : « Ajoute un graphique des totaux au tableur joint » ou « Convertis le document Word joint en PDF ». L’assistant copie le fichier dans la sandbox légère et renvoie le résultat sous forme de nouveau fichier. Le fichier joint reste tel quel.

## Utiliser un skill

Un skill est une méthode éprouvée pour un type de travail, comme un format de document ou une charte rédactionnelle. L’assistant voit le nom et la description de chaque skill de ta bibliothèque, c’est-à-dire de ceux qui sont partagés avec toute l’organisation ou avec tes équipes. Quand l’un d’eux correspond à ta demande, il le lit avant de commencer et le suit ; les étapes affichent alors, par exemple, **Lecture du skill docx**. Les skills intégrés `docx`, `xlsx`, `pptx` et `pdf` couvrent les formats Office et PDF.

Pour être sûr qu’un skill est utilisé, nomme-le : « Utilise le skill brief-summary pour résumer le brief joint. » Un skill que son auteur réserve à un usage explicite n’est utilisé que si tu le demandes par son nom. Dans une bibliothèque de plus de 40 skills, l’assistant voit les 40 premiers par ordre alphabétique et utilise tout autre skill dès que tu le nommes.

Un skill guide l’assistant ; il ne change pas ce que l’assistant a le droit de faire. Les scripts et modèles d’un skill s’exécutent dans la sandbox légère, comme le code de l’assistant lui-même.

## Connaître les limites

- Une sandbox légère appartient à une seule conversation. Elle garde ses fichiers entre les étapes de l’assistant et tes messages de suivi ; après environ cinq minutes sans utilisation, elle est supprimée et la demande suivante en démarre une nouvelle. Quand toutes les sandboxes légères de ton organisation sont occupées, une sandbox inutilisée cède sa place ; si aucune n’est inutilisée, l’assistant t’invite à réessayer dans une minute.
- Une exécution de code dure au plus trois minutes. Elle joint jusqu’à 10 fichiers, de 20 Mo chacun au plus.
- Un fichier que l’assistant rédige lui-même contient au plus 1 Mo de texte.
- Une demande crée jusqu’à 4 images, et une réponse jusqu’à 16. Les images sont facturées à ton organisation et comptent pour toi, comme la réponse elle-même.

Un admin décide de ce que le chat peut créer sous [Outils du chat](/fr/platform/admin/governance/policies-and-limits#chat-tools), s’il peut créer des images sous [Génération d’images](/fr/platform/admin/governance/content-models#let-agents-generate-images), et du nombre de sandboxes légères que ton organisation exécute en même temps sous [Sandboxes](/fr/platform/admin/sandboxes#light-sandboxes). Un outil désactivé disparaît de tous les chats ; l’assistant répond alors directement ou propose une tâche à la place.
