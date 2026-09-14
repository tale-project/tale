---
title: Entrées de connaissances
description: Enregistre une information courte dans les connaissances partagées, actualise-la et consulte ses versions précédentes.
---

Une entrée de connaissances convient à une information courte que tes collègues doivent pouvoir retrouver : horaires du support, délai de retour ou responsable d’un processus. Elle comporte un sujet et un contenu. Pour une politique complète ou un rapport, choisis un [document](/fr/platform/knowledge/documents). Pour des champs nommés et des valeurs exactes, utilise les [données structurées](/fr/platform/knowledge/structured-data).

Les membres peuvent lire les entrées. Le rôle Éditeur ou supérieur est nécessaire pour les créer, les modifier et les supprimer. Elles font partie des connaissances partagées de l’organisation : réserve tes notes personnelles et les informations destinées à un seul projet à un autre espace.

## Ajouter une information

<Steps>

<Step title="Ouvrir le formulaire">

Va dans **Connaissances > Entrées de connaissances**, puis clique sur **Ajouter une entrée**. Si l’action n’apparaît pas, demande à un administrateur de vérifier ton rôle.

</Step>

<Step title="Choisir un sujet durable">

Dans **Sujet**, saisis par exemple `Délai de réponse du support`. Choisis un nom qui restera pertinent si la réponse change. Le sujet est limité à 120 caractères et doit être unique. Si Tale signale un doublon, modifie l’entrée existante.

</Step>

<Step title="Donner le contexte nécessaire">

Dans **Contenu**, indique l’information, son périmètre et ses conditions. Le Markdown est accepté, jusqu’à 8 000 caractères. Par exemple :

```markdown
Le support vise une première réponse sous 45 minutes pendant les heures
ouvrées : du lundi au vendredi, de 09:00 à 17:00 CET. Il s’agit d’un objectif
de réponse, pas d’un délai de résolution. Responsable : Support Operations.
```

Évite les dates relatives comme « vendredi prochain » et les renvois comme « la politique ci-dessus ». L’entrée doit rester compréhensible lorsqu’elle est consultée seule.

</Step>

<Step title="Enregistrer et vérifier l’indexation">

Clique sur **Enregistrer**. La ligne affiche le sujet, le contenu, la source, le statut d’indexation et la date de mise à jour. Ouvre-la pour lire le texte intégral. L’indexation s’effectue en arrière-plan : une entrée enregistrée n’est pas immédiatement disponible dans la recherche.

</Step>

</Steps>

<Frame caption="Le tableau permet de vérifier l’information et son indexation avant de s’appuyer dessus dans une réponse.">

![Le tableau des entrées de connaissances présente des informations manuelles avec sujet, contenu, source, statut d’indexation et date de mise à jour.](/images/platform/knowledge-entries-list.webp)

</Frame>

## Corriger une information existante

Dans le menu de la ligne, choisis **Modifier**, corrige le contenu et clique sur **Enregistrer**. Cela crée une nouvelle version courante et programme l’indexation de son texte. Chaque sujet possède une seule entrée courante ; corriger l’entrée existante évite les réponses contradictoires.

Après une correction, ouvre les détails pour consulter l’**Historique des versions**. Les anciennes versions permettent de retrouver ce qui a changé et leur date de remplacement. Elles ne constituent pas des informations courantes supplémentaires. Une application peut également créer et modifier des entrées via l’[API REST](/fr/develop/api-reference).

<Tip>

Lorsqu’un chat fait ressortir une information utile, vérifie-la à la source, puis ajoute ou modifie l’entrée toi-même. Chat n’enregistre pas automatiquement les faits dans les connaissances de l’organisation.

</Tip>

## Retirer une entrée obsolète

Choisis **Supprimer** dans le menu de la ligne et lis la confirmation. L’entrée et ses versions disparaissent de cette vue ; le document associé n’est plus disponible pour la recherche dans les connaissances. Garde une copie du texte avant la suppression si tu en as encore besoin. Pour une correction, utilise **Modifier**.

## Si l’information manque dans une réponse

Vérifie d’abord l’entrée courante : est-elle enregistrée et indexée ? La question désigne-t-elle clairement son sujet ? Si l’indexation a échoué, résous la cause indiquée avant de la relancer. En cas d’échecs répétés, un administrateur doit vérifier la configuration des embeddings et les services d’indexation.

Demande une citation à l’assistant, ouvre la source et compare-la à l’entrée. Une réponse plausible ne prouve pas qu’elle utilise la dernière information. La page [Documents](/fr/platform/knowledge/documents) détaille les états d’indexation communs.
