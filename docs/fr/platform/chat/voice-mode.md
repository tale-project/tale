---
title: Mode vocal
description: Parler au lieu de taper — comment un enregistrement devient un message, comment une réponse est relue à voix haute, et quels fournisseurs touchent l’audio au passage.
---

Le mode vocal transforme la zone de saisie en microphone. Tu parles, l’enregistrement est transcrit dans ton message suivant, l’agent répond en texte, et cette réponse peut être lue à voix haute. La boucle se fait sans les mains, ce qui vaut beaucoup quand tu marches, tu cuisines ou tu en as assez de taper — et elle traverse deux fournisseurs vocaux, ce qui mérite d’être su avant d’y faire passer les données de ton organisation.

Cette page couvre les deux moitiés de l’aller-retour et la frontière que franchit l’audio. Le chat lui-même ne change pas : la voix est une enveloppe autour du même flux de messages que décrit [Bases du chat](/fr/platform/chat/basics).

## De la parole au texte

Lance l’enregistrement depuis le micro de la zone de saisie et parle ; arrête-le de la même façon. L’enregistrement part, un modèle de reconnaissance vocale le transcrit, et la transcription devient le message suivant du chat — exactement comme si tu l’avais tapé. Tu peux relire la transcription avant qu’elle parte, et cela compte : une erreur de transcription devient indiscernable d’une question mal formulée dès que l’agent y a répondu.

La transcription tourne une fois par message parlé. Ce que l’agent reçoit, c’est du texte ; aucun audio n’atteint le modèle de chat.

## Du texte à la parole

Faire lire une réponse à voix haute est un choix que tu poses dans la zone de saisie, pour le tour que tu t’apprêtes à envoyer. Active la sortie vocale et la réponse qui revient part vers un modèle de synthèse et se joue à mesure qu’elle arrive ; laisse-la éteinte et la réponse atterrit en texte comme n’importe quelle autre. La lecture peut être coupée avant la fin, et la dernière réponse peut être rejouée sans reposer la question.

<Note>

La sortie vocale est un contrôle de la zone de saisie, pas une préférence enregistrée. Aucune voix n’est épinglée à un agent et aucune valeur par défaut à l’échelle de l’organisation ne décide pour toi — la portée du choix est le tour que tu envoies, ce qui évite qu’une session mains libres te suive jusque dans un bureau partagé.

</Note>

## Qui détient quelle partie

Deux choix de modèles comptent ici, et aucun n’est le modèle du sélecteur. La reconnaissance vocale tourne avant le tour de l’agent, sur l’audio. La synthèse tourne après, sur la réponse finie. L’agent entre les deux ne change pas — mêmes instructions, mêmes tools, même contrat de contexte.

Les deux sont configurés par la personne qui administre les fournisseurs de l’organisation. Si aucun fournisseur vocal n’est configuré, les contrôles vocaux n’ont rien à appeler, et la réponse est d’en connecter un plutôt que de changer quoi que ce soit dans le chat.

## La frontière de confidentialité

L’enregistrement quitte ton appareil. Il est déposé dans le stockage de Tale, envoyé au fournisseur de reconnaissance vocale que l’organisation a configuré, et la transcription obtenue reste dans l’historique du chat à côté des messages tapés — cherchable, exportable, et soumise aux mêmes règles de rétention que le reste du chat. L’audio lui-même suit la politique de rétention de l’organisation.

Les réponses partent vers le fournisseur de synthèse en texte brut, et l’audio renvoyé est streamé vers ton appareil plutôt que stocké.

<Warning>

Les organisations soumises à des règles strictes de résidence des données devraient choisir des fournisseurs vocaux dans la même région que le reste de la pile — l’audio et la transcription relèvent des mêmes règles que n’importe quel autre contenu de message. Voir [Résidence des données](/fr/cloud/data-residency).

</Warning>

## Quand la voix bat le texte

La voix va plus vite que le clavier pour les questions courtes et conversationnelles, et nettement moins vite pour tout ce que tu recopieras ensuite. Une réponse parlée s’entend une fois ; une réponse écrite se survole, se cite et se colle.

| Prends … quand                                      | Voix | Texte |
| --------------------------------------------------- | ---- | ----- |
| Tu as les mains prises et tu veux un fait rapide    | ✓    |       |
| La réponse sera une longue liste ou un bloc de code |      | ✓     |
| La réponse alimentera un travail écrit plus tard    |      | ✓     |
| Tu pratiques une langue et tu veux l’entendre       | ✓    |       |

## Où cela s’inscrit

La voix est l’une des trois formes d’entrée de la même zone de saisie : la frappe, les [pièces jointes](/fr/platform/chat/attachments) et la parole. La confidentialité pèse le plus lourd ici parce que deux fournisseurs supplémentaires touchent les données ; la page suivante dépend donc de ton édition — [Résidence des données](/fr/cloud/data-residency) sur le Cloud, ou [Fournisseurs](/fr/self-hosted/configuration/providers) si tu héberges Tale toi-même et choisis les fournisseurs vocaux comme les modèles de chat.
