---
title: Créer des fichiers et utiliser des skills
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

Un fichier qui doit être relu, conservé avec d’autres travaux ou créé plus tard a sa place dans une tâche : l’[agent standard](/fr/platform/projects/project-agents#standard-agent-runs) du projet y utilise les mêmes outils, et les fichiers qu’il crée deviennent les fichiers produits de la tâche.

Pendant que l’assistant travaille, les étapes au-dessus de la réponse indiquent ce qu’il fait, par exemple **Rédaction de contacts.csv**, **Lecture du skill xlsx** ou **Exécution de Python dans une sandbox légère**. Une étape en échec explique sur la ligne en dessous ce qui n’a pas marché, par exemple **Toutes les sandboxes légères sont occupées** ou **Le programme s'est terminé par une erreur**, et l’assistant corrige le plus souvent son code avant de réessayer.

## Ouvrir et télécharger les fichiers

Les fichiers apparaissent sous la réponse, dans l’ordre où ils ont été créés. Les images PNG, JPEG, GIF et WebP s’affichent directement ; sélectionnes-en une pour l’ouvrir en grand et parcourir les autres. Chaque autre fichier, y compris un fichier SVG, s’affiche sous forme de carte avec son nom, son type et sa taille, tout comme une image qui ne peut pas être affichée. Sélectionne la carte pour afficher un aperçu ; les PDF, documents Word, tableurs, fichiers Markdown, fichiers texte et fichiers SVG s’ouvrent directement. Le bouton de téléchargement à côté de la carte enregistre le fichier sous son propre nom.

<Frame caption="Le fichier rédigé par l’assistant apparaît sous forme de carte sous sa réponse, avec un bouton de téléchargement à côté.">

![Un chat demande les thèmes des retours d’onboarding dans un fichier CSV. Les étapes montrent la rédaction de onboarding-feedback-themes.csv, la réponse indique que le fichier est joint, et une carte en dessous affiche onboarding-feedback-themes.csv, CSV, 251 octets, avec un bouton de téléchargement.](/images/platform/chat-reply-files.webp)

</Frame>

Quand l’assistant retouche un fichier dans la même réponse, par exemple après avoir vérifié son résultat, la carte n’affiche que la version finale. Demande une modification dans un message de suivi pour obtenir une nouvelle version dans la réponse suivante.

Quand l’assistant a tenté en vain de créer un fichier, ou qu’il a exécuté du code dans la sandbox légère puis annonce avoir joint un fichier qui n’existe pas, **Aucun fichier n'a été joint à cette réponse** s’affiche sous la réponse. Redemande le fichier dans un message de suivi.

Les fichiers appartiennent à la conversation : quiconque peut ouvrir la conversation peut ouvrir ses fichiers.

## Modifier un fichier joint

[Joins le fichier](/fr/platform/chat/attachments) et indique ce qui doit changer : « Ajoute un graphique des totaux au tableur joint » ou « Convertis le document Word joint en PDF ». L’assistant copie le fichier dans la sandbox légère et renvoie le résultat sous forme de nouveau fichier. Le fichier joint reste tel quel.

Une image jointe peut aussi servir de point de départ à une nouvelle image quand ton organisation autorise la [génération d’images](/fr/platform/admin/governance/content-models#let-agents-generate-images). Demande par exemple : « Transforme la photo jointe en aquarelle ». L’assistant transmet la photo au modèle d’images, et la nouvelle image apparaît sous la réponse.

## Utiliser un skill

Un skill est une méthode éprouvée pour un type de travail, comme un format de document ou une charte rédactionnelle. Ta bibliothèque de skills contient ceux qui sont partagés avec toute l’organisation ou avec tes équipes ; les skills intégrés `docx`, `xlsx`, `pptx` et `pdf` couvrent les formats Office et PDF.

Dans un chat, tu utilises un skill de trois façons :

| Comment tu l’utilises | Quelles réponses le lisent |
| --- | --- |
| Tu commences un message par `/` et le nom du skill | La réponse à ce message, avant de répondre |
| Tu le coches sous **Skills** dans le sélecteur de modèle | Chaque réponse de la conversation, chacune avant de répondre |
| Tu laisses faire l’assistant, qui lit un skill quand il correspond à ta demande | La réponse pour laquelle il lit le skill |

Pour un seul message, tape `/` au début de la zone de saisie, ou choisis **Utiliser un skill** dans le menu **+** de la zone de saisie. Les skills que tu peux utiliser s’affichent au-dessus de la zone ; continue à taper pour réduire la liste, puis appuie sur Entrée ou sélectionnes-en un. Ton message commence alors par le nom du skill, par exemple `/docx Rédige la lettre de motivation`, et l’affiche sous forme de puce une fois envoyé. La réponse lit le skill avant de répondre : sa première étape est **Lecture du skill docx**.

![Un nouveau chat avec une barre oblique tapée dans la zone de saisie. Au-dessus, la liste des skills docx, pdf, pptx, visual-aspect-analyzer et xlsx, chacun avec le début de sa description ; docx est mis en évidence.](/images/platform/chat-skill-picker.webp)

Pour toute une conversation, ouvre le sélecteur de modèle, va dans **Skills** et coche jusqu’à quatre skills. Chaque réponse de cette conversation les lit avant de répondre. Un nouveau chat commence sans skill.

L’assistant lit aussi un skill de lui-même quand l’un d’eux correspond à ta demande, ou quand tu le nommes avec tes mots. Il voit le nom et la description de chaque skill de ta bibliothèque ; dans une bibliothèque de plus de 40 skills, il voit les 40 premiers par ordre alphabétique, alors choisis tout autre skill avec `/`. Un skill que son auteur réserve à un usage explicite est fait pour que tu le choisisses : l’assistant est prié de ne pas l’utiliser autrement.

Un skill peut aussi dire comment l’assistant écrit : un ton, un format, une formule de fin pour chaque réponse. L’assistant suit un skill tout au long de la réponse qui le lit, dans sa façon d’écrire comme dans ce qu’il fait. Un skill que l’assistant lit de lui-même est lu pour cette réponse ; les réponses suivantes ne le relisent que s’il le choisit de nouveau. Pour qu’un skill façonne chaque réponse, coche-le sous **Skills** : chaque réponse le lit alors en entier avant de répondre.

Un skill guide l’assistant ; il ne change pas ce que l’assistant a le droit de faire, et là où il contredit les autres instructions de l’assistant, comme celles de ton organisation, ce sont elles qui l’emportent. Les scripts et modèles d’un skill s’exécutent dans la sandbox légère, comme le code de l’assistant lui-même ; un skill fait uniquement d’instructions ne démarre aucune sandbox. Quand un admin désactive **Skills** sous Outils du chat, il n’y a rien à choisir, et un message qui commence par `/` est envoyé tel quel.

## Connaître les limites

- Une sandbox légère appartient à une seule conversation. Elle garde ses fichiers entre les étapes de l’assistant et tes messages de suivi ; après environ cinq minutes sans utilisation, elle est supprimée et la demande suivante en démarre une nouvelle. Quand toutes les sandboxes légères de ton organisation sont occupées, une sandbox inutilisée cède sa place ; si aucune n’est inutilisée, l’assistant t’invite à réessayer dans une minute.
- Une exécution de code dure au plus trois minutes, et les outils d’une étape disposent ensemble de cinq minutes au plus. Au plus 16 outils s’exécutent dans une étape. Si tu appuies sur **Arrêter la génération**, un programme en cours est interrompu en quelques secondes. Une exécution joint jusqu’à 10 fichiers, de 20 Mo chacun au plus ; quand un programme en écrit beaucoup plus, la réponse en nomme quelques-uns et compte les autres.
- Un fichier que l’assistant rédige lui-même contient au plus 1 Mo de texte.
- Une demande crée jusqu’à 4 images, et une réponse jusqu’à 16. Une demande peut partir de 4 images de la conversation au plus, ou de moins si le modèle d’images en accepte moins. Les images sont facturées à ton organisation et comptent pour toi, comme la réponse elle-même.
- Quand les outils de création de fichiers ne peuvent pas être mis en place pour une réponse, par exemple parce que la politique Outils du chat de ton organisation est illisible, la réponse l’indique en dessous. Redemande plus tard, ou demande à un admin de vérifier la politique.

Un admin décide de ce que le chat peut créer sous [Outils du chat](/fr/platform/admin/governance/policies-and-limits#chat-tools), s’il peut créer des images sous [Génération d’images](/fr/platform/admin/governance/content-models#let-agents-generate-images), et du nombre de sandboxes légères que ton organisation exécute en même temps sous [Sandboxes](/fr/platform/admin/sandboxes#light-sandboxes). Un outil désactivé disparaît de tous les chats ; l’assistant répond alors directement ou propose une tâche à la place.

L’assistant ne crée des images que si la génération d’images est activée et que les identifiants fournisseur de ton organisation atteignent un modèle d’images. Sinon, quand tu demandes une photo, une illustration ou une œuvre d’art, il répond que la génération d’images n’est pas disponible et qu’un admin ou un propriétaire peut l’activer sous **Paramètres > Gouvernance > Modèles**. Il ne te remet pas un SVG en guise d’image ; il continue de rédiger des fichiers SVG pour les schémas, les icônes et les graphiques.

## Si le chat ne crée ni fichiers ni images {#when-chat-makes-no-files}

Si la même demande crée un fichier ou une image ailleurs, mais pas dans ton organisation, demande à un admin de consulter **État des outils du chat** sous **Paramètres > Gouvernance > Politiques et limites**. Il indique, pour les fichiers, le code, les skills et les images, si le chat de ton organisation peut les utiliser en ce moment, et ce qui l’en empêche sinon : un interrupteur sous Outils du chat, un service de sandbox absent ou qui ne répond pas, une sandbox légère qui n’a pas pu démarrer, un skill de documents absent de la bibliothèque de skills, ou une génération d’images sans modèle d’images. [Voir ce que le chat peut utiliser](/fr/platform/admin/governance/policies-and-limits#chat-tool-status) explique chacun de ces cas.

Pour t’assurer que la sandbox qu’utilise le chat peut créer un document, appuie sur **Lancer la vérification** dans ce panneau si tu es propriétaire ou admin, ou demande-le à l’un d’eux. En une minute au plus, la vérification démarre une sandbox légère comme le fait le chat, y cherche les bibliothèques qu’utilisent les skills de documents, lui fait créer un petit fichier Word et affiche **Réussie**, ou nomme ce qui a échoué, par exemple un service de sandbox injoignable ou une bibliothèque absente de la sandbox. Elle ne regarde ni les interrupteurs sous Outils du chat ni la bibliothèque de skills ; les lignes au-dessus d’elle dans le panneau les indiquent.
