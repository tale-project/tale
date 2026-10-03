---
title: "Comment choisir le moteur d’un agent IA ?"
description: "Distingue moteur d’exécution et modèle, élimine les configurations incompatibles et compare les autres sur une tâche dont ton équipe a vraiment besoin."
slug: choose-ai-agent-runtime-model-skills
topicId: T09
reviewed: '2026-10-03'
draft: false
coverAlt: "Des composants distincts et ajustés forment une configuration d’agent."
---

Un modèle génère des réponses et propose des actions. Le moteur d’exécution d’un agent, aussi appelé runtime ou harness, gère la session qui l’entoure : il appelle les outils, travaille sur les fichiers et transmet les résultats au modèle. Choisir un modèle ne répond donc qu’à une partie de la question. Il te faut aussi un logiciel capable d’accomplir le travail avec tes fichiers, tes outils et tes règles d’accès.

Pars d’une tâche que ton équipe connaît déjà. Écarte les configurations qui ne peuvent pas l’accomplir dans vos conditions d’exploitation, puis compare les candidates restantes sur cette tâche. Une liste de fonctionnalités aide à faire une présélection ; le travail terminé permet de choisir.

## Sache quelle partie tu choisis

Supposons que tu aies besoin d’une synthèse de recherche à partir d’un document interne et de plusieurs sources publiques. Le modèle peut très bien comprendre la question et l’exécution échouer malgré tout, parce qu’elle ne peut pas ouvrir le document, atteindre une source ou rendre un fichier modifiable.

Il est utile de distinguer les éléments de la configuration :

- Le **moteur d’exécution** gère la session de travail et l’utilisation des outils.
- Le **modèle et son fournisseur** déterminent quel modèle répond et comment tu y accèdes.
- Les **skills** fournissent des consignes et des ressources réutilisables pour un type de travail.
- Les **outils et les identifiants** déterminent les opérations disponibles.
- L’**espace de travail** contient les fichiers que l’agent lit, crée et peut devoir retrouver plus tard.

Ces éléments doivent fonctionner ensemble. Un skill expliquant comment produire un tableur n’est utile que si l’exécution dispose des outils nécessaires. Un modèle disponible dans le chat ordinaire ne l’est pas forcément avec le moteur et les identifiants choisis. Le [guide des moteurs d’exécution de Tale](https://docs.tale.dev/fr/platform/agents/harnesses) détaille les combinaisons prises en charge et leur comportement.

![Moteur d’exécution, modèle, fournisseur, skills, outils et espace de travail constituent une configuration. Vérifie leur compatibilité sur la tâche que tu veux déléguer.](/blog/diagrams/fr/T09-diagram.svg)

## Écarte les options qui ne satisfont pas les exigences

Écris un bref énoncé avant d’essayer les candidates. Par exemple :

> Compare trois fournisseurs à partir des exigences jointes et de leur documentation produit publique. Fournis un comparatif modifiable avec une source pour chaque affirmation importante. Je pourrai changer le public visé après la première recherche. Laisse tes notes et tes sources pour qu’une autre personne puisse continuer. Ne contacte aucun fournisseur et ne publie rien.

Ajoute les contraintes qui comptent vraiment pour l’équipe : quelles données peuvent sortir de l’entreprise, quels comptes sont disponibles et quels contrôles des dépenses sont obligatoires. Distingue une exigence d’un simple confort. Si les fichiers modifiables sont indispensables, une belle réponse qui ne les produit pas ne satisfait pas le besoin.

Demande à chaque candidate de démontrer l’accès aux fichiers, la connexion aux outils et le format de sortie nécessaires. Utilise le rôle qui lancera la vraie tâche. Une configuration qui ne fonctionne qu’avec des identifiants administrateur n’est pas prête à être confiée à un membre de l’équipe.

Le mode d’accès au fournisseur peut aussi décider de la présélection. Dans Tale, par exemple, les appels directs via un abonnement compatible échappent au comptage et aux plafonds de dépenses de sa passerelle. Si ces plafonds sont obligatoires, vérifie d’abord qu’un mode d’accès convient avant de juger les textes. Consulte la [documentation actuelle sur les moteurs et les identifiants](https://docs.tale.dev/fr/platform/agents/harnesses).

## Compare le travail et les corrections nécessaires

Donne le même énoncé et les mêmes sources aux candidates restantes. Définis à l’avance ce qui rend le comparatif utilisable : couvrir les exigences citées, renvoyer aux passages qui étayent les affirmations, distinguer une information manquante d’un constat négatif et produire les fichiers demandés.

Lis les documents plutôt que de te fier au message de fin de l’agent. « Le site du fournisseur ne le mentionne pas » devient-il « le fournisseur ne le propose pas » ? Les liens étayent-ils réellement la comparaison ? Combien de vérifications et de réécriture seraient nécessaires avant de la partager ?

Un premier résultat prometteur donne une raison d’essayer d’autres cas représentatifs. Inclus une source peu détaillée, une affirmation contradictoire et un document semblable aux cas difficiles de ton équipe. Le [guide d’évaluation d’un pilote IA](/fr/blog/evaluate-ai-agents-business-tasks) explique comment comparer les résultats utilisables et l’effort humain qu’ils demandent.

Pendant les essais, note le moteur, le modèle, le fournisseur, la version du skill et les outils accordés. Tu choisis cette configuration complète. Si deux candidates utilisent des modèles et des outils différents, un meilleur résultat ne révèle pas quel élément a fait la différence. Tu n’as pas besoin de résoudre cette question de recherche pour faire un choix pratique, mais ne présente pas ce résultat comme la preuve d’un modèle supérieur dans tous les cas.

## Essaie une correction et une transmission avant de choisir

Une recherche suit rarement le premier énoncé sans changement. Une fois les sources rassemblées par chaque candidate, remplace le public visé : au lieu d’un acheteur technique, adresse le comparatif à une responsable financière. Vérifie que le document final reflète ce changement et que les fichiers associés ne conservent pas d’anciennes hypothèses. Transmets la correction au même stade de la tâche, plutôt qu’après le même nombre de secondes.

Demande ensuite à un autre agent de continuer à partir des notes enregistrées. Peut-il retrouver les sources et comprendre ce qui reste incertain ? Conserver des fichiers, reprendre une conversation et transmettre le travail à quelqu’un d’autre sont trois choses différentes. Pour cette transmission, utilise [un court brief de reprise](/fr/blog/persistent-ai-agent-workspaces-handoffs).

Si tu as équipé l’agent d’un skill de recherche, vérifie une de ses consignes précises dans le résultat. Une exigence de séparation entre faits observés et hypothèses devrait, par exemple, produire une distinction visible dans la synthèse. La présence du skill dans la configuration ne prouve pas que l’agent l’a suivi.

Choisis la configuration qui satisfait les exigences et laisse régulièrement moins de travail à terminer à l’équipe. Si deux candidates sont proches, conserver un moteur familier peut valoir davantage qu’un petit avantage sur un seul exemple. Garde quelques tâches représentatives à refaire lorsque le modèle, le moteur, les outils ou les skills changent.

La [fiche de sélection d’un moteur d’exécution](/blog/worksheets/fr/T09-runtime-selection.md) permet de garder la présélection, les détails de configuration et les observations. Une décision utile est précise : « Utilisons cette configuration pour la recherche de fournisseurs ; elle traite nos fichiers sources, intègre les corrections et laisse des notes vérifiables. » Cela suffit pour lancer un pilote limité sans prétendre avoir trouvé le meilleur agent pour chaque travail.
