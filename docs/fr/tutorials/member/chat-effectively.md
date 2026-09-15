---
title: Obtenir une réponse utile dans Chat
description: Exerce-toi à poser une question précise, vérifier une citation et améliorer la réponse par une relance.
---

Une réponse utile commence par une question claire et se termine par une vérification de la source. Pour cet exercice, utilise un court document que tu as le droit d’importer. Interroge-le sur un fait, puis vérifie si l’assistant distingue ce qui est écrit de ce qui reste ouvert.

Tu dois avoir accès à Chat et à un modèle disponible. Les questions sur les documents nécessitent aussi une indexation fonctionnelle dans l’organisation. Si tu disposes déjà d’un document adapté et indexé, tu peux l’utiliser à la place de l’exemple.

## Préparer une petite source

Enregistre ce texte sur ton appareil dans `launch-brief.txt` :

```text
Brief de refonte du site
La relecture avec le client est prévue le 18 septembre 2026.
Maya Chen est responsable de la checklist de relecture.
La date de lancement n’est pas approuvée.
La relecture doit couvrir l’accessibilité, les redirections et le formulaire de contact.
```

Ouvre un nouveau chat et joins le fichier avec **Ajouter photos et fichiers** dans le menu du champ de message. Attends la fin de l’import et de l’indexation avant de poser une question sur son texte. [Pièces jointes du chat](/fr/platform/chat/attachments) explique les états affichés.

## Demander un résultat précis

Envoie :

```text
À partir de launch-brief.txt, indique la date de relecture, la personne
responsable et les trois sujets à vérifier. Cite la source. Utilise quatre puces.
```

La demande précise la source, les informations nécessaires et la forme attendue. Elle est plus facile à évaluer que « Parle-moi du lancement ». **Auto** convient pour commencer. Choisis explicitement un modèle lorsque tu veux comparer son comportement à celui d’un autre.

<Frame caption="Garde la question sous les yeux pour vérifier si la réponse y satisfait.">

![Un chat montre une question ciblée sur les retours d’onboarding et une réponse présentée en tableau.](/images/platform/chat-thread-reply.webp)

</Frame>

## Comparer la réponse au fichier

La date de relecture doit être le **18 septembre 2026**, la responsable **Maya Chen** et les sujets **l’accessibilité, les redirections et le formulaire de contact**. Ouvre la source citée et compare ces valeurs. La présentation peut varier ; les faits doivent rester les mêmes.

Si la réponse ne cite pas de source, demande une citation du document au lieu de supposer que la pièce jointe a été lue. Si le contenu reste introuvable, vérifie l’indexation et réessaie lorsque le fichier est prêt. Une réponse fluide ne prouve pas que la source a été consultée.

## Poser une relance qui révèle l’incertitude

Dans la même conversation, demande :

```text
Quelle est la date de lancement approuvée ? Si le brief n’en donne pas,
indique-le clairement.
```

La source ne donne **pas** de date de lancement approuvée. Une bonne réponse conserve cette distinction au lieu de prendre la date de relecture pour celle du lancement. Si une réponse fait une supposition sans preuve, cite la phrase contradictoire et demande une correction.

<Tip>

Modifie un élément de la demande à la fois. « Fais plus court » teste la longueur ; « Sépare les dates confirmées des décisions ouvertes » teste l’interprétation. Changer en même temps source, modèle, question et format empêche de comprendre ce qui a amélioré le résultat.

</Tip>

## Conserver le contexte utile

Poursuis dans le même chat pour les questions liées au sujet. Commence un autre chat pour un sujet sans rapport, afin que les anciennes hypothèses ne gênent pas la nouvelle demande. Si plusieurs conversations ont besoin de ce brief, place-le dans un [projet](/fr/tutorials/member/use-projects) et utilise le chat du projet.

Avant de [partager un chat](/fr/platform/chat/shared-threads), relis les messages et les extraits de sources cités dans la réponse. Si la suite consiste à produire un livrable avec un responsable et une relecture, crée une [tâche de projet](/fr/platform/projects/tasks) avec les faits vérifiés et les critères d’acceptation.
