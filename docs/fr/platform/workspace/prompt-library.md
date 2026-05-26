---
title: Bibliothèque de prompts
description: La bibliothèque de prompts est l'endroit où tu enregistres des prompts de chat pour réutilisation — personnel, équipe ou à l'échelle de l'org. Les Membres, Éditeurs et Développeurs lisent ceci quand ils gardent une amorce de chat récurrente sous la main.
---

La bibliothèque de prompts est la surface des prompts enregistrés de Tale. C'est là que tu gardes les amorces de chat que tu cherches plus d'une fois — un prompt de voix d'écriture que tu réutilises pour chaque brouillon de mail client, un prompt de débogage que ton équipe se passe, un prompt de recherche sur lequel toute l'org devrait s'aligner. Chaque rôle au-dessus de Désactivé peut enregistrer et utiliser des prompts ; le levier **visibilité** sur chaque prompt décide qui d'autre le voit.

Cette page est la référence pour ce qu'est un prompt, comment se comportent les trois niveaux de visibilité, comment marche l'historique des versions, et comment les prompts entrent dans un chat. La bibliothèque vit sous **Prompts** dans la barre latérale ; la même bibliothèque apparaît en ligne dans le composer de chat.

## Ce qu'est un prompt

Un prompt est un morceau de texte enregistré — généralement une question ou une instruction que tu taperais autrement dans le composer — avec un titre et quelques champs de métadonnées. Quand tu vas chercher un prompt enregistré dans chat, Tale colle son contenu dans le composer ; tu peux éditer avant d'envoyer, le prompt n'est pas un message système caché.

Chaque prompt porte :

- Un **titre** (utilisé dans le picker ; auto-généré du contenu si tu le laisses vide).
- Le **contenu** (le texte du prompt lui-même).
- Une **visibilité** — `Personnel`, `Équipe`, ou `Global`.
- Une liaison **équipe** optionnelle (quand visibilité est `Équipe`).
- Des **tags** optionnels pour filtrer.

La bibliothèque est cherchable par titre et contenu, filtrable par visibilité et tag, et triable par récence. Le picker en ligne du composer est la même bibliothèque avec les mêmes filtres.

## Les trois niveaux de visibilité

**Personnel** est pour tes yeux uniquement. Un prompt personnel apparaît dans ta propre bibliothèque et nulle part ailleurs ; personne dans l'org ne peut le voir. Va vers personnel quand le prompt est formé à ton propre flux et que le reste de l'équipe n'en tirerait pas profit.

**Équipe** est partagé avec une équipe. Choisis l'équipe à l'enregistrement ; chaque membre de cette équipe voit le prompt dans sa bibliothèque. Va vers équipe quand le prompt est formé à une fonction spécifique — le prompt de ton-de-réponse de l'équipe support, le prompt de triage-bugs de l'équipe ingénierie — et que le reste de l'org n'en tirerait pas profit.

**Global** est à l'échelle de l'org. Chaque membre de l'org voit le prompt dans sa bibliothèque. Va vers global quand le prompt encode une décision que toute l'org devrait prendre de la même façon — la voix d'écriture qu'attend la marque, le modèle de question avec lequel chaque chercheur devrait commencer.

La visibilité se règle à l'enregistrement et s'édite plus tard. Promouvoir un prompt personnel à global est un clic et ne déclenche aucune migration sur les chats qui l'avaient déjà utilisé — les anciens chats gardent leur contenu collé, la nouvelle visibilité n'affecte que l'entrée de bibliothèque.

## Versionnement

Enregistrer un prompt par-dessus une entrée existante crée une nouvelle version. L'historique des versions est joignable depuis la ligne du prompt ; chaque version enregistre l'éditeur, l'horodatage, et le diff de contenu. Tu peux revenir à n'importe quelle version antérieure en un clic.

L'historique des versions est l'endroit où regarder quand un coéquipier a édité un prompt global et que le nouveau contenu ne marche pas pour ton cas d'usage. Reviens en arrière au niveau bibliothèque si tout le monde devrait revenir ; copie la version plus ancienne dans un prompt personnel si seul toi veux l'ancien comportement.

## Utiliser un prompt dans chat

Le composer de chat a un picker de prompts à sa base. Ouvre-le, cherche ou filtre pour trouver le prompt voulu, et clique-le pour coller le contenu dans le composer. Le prompt est maintenant ton message — édite-le, attache des fichiers, ajoute du contexte, envoie. Une fois envoyé, le prompt agit comme n'importe quelle entrée de composer ; Tale ne suit pas quels chats ont utilisé quels prompts.

Certains prompts contiennent des variables de template — placeholders comme `{{customer_name}}` ou `{{topic}}`. Le picker te demande chaque variable avant de coller ; le contenu résultant est le prompt avec les placeholders remplis. Les variables sont déclarées dans le contenu du prompt avec la syntaxe `{{variable_name}}`.

## Limites et cycle de vie

Le contenu d'un prompt a une limite de taille — le formulaire de bibliothèque montre l'usage actuel contre le maximum, et le bouton Enregistrer est désactivé si tu dépasses. La limite est généreuse assez pour que la plupart des prompts passent ; si tu butes, la bonne réponse est généralement que le prompt est deux prompts.

Supprimer un prompt n'est réversible que via l'historique des versions si tu l'avais enregistré au moins une fois avant. Les prompts personnels sont supprimés définitivement à la suppression de compte ; les prompts d'équipe survivent à la réorganisation d'équipe sauf si l'équipe est supprimée ; les prompts globaux survivent à tout sauf à une suppression explicite.

## Où cela s'inscrit

La bibliothèque de prompts est la forme la plus légère de réutilisation dans Tale — plus légère qu'un agent (qui porte instructions, connaissance et tools), plus légère qu'un skill (qui empaquette instructions et un script). Va vers un prompt quand la réutilisation est juste le texte ; va vers un agent quand la réutilisation est un comportement configuré. La lecture suivante naturelle est [Amorces et prompts](/fr/platform/chat/starters-and-prompts) pour comment les prompts surgissent dans le composer de chat à côté des amorces propres d'un agent.
