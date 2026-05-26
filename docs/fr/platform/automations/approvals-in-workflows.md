---
title: Approbations dans les workflows
description: Une étape de workflow peut être un gate d'approbation qui met l'exécution en pause jusqu'à ce qu'un humain décide. Cette page couvre les états du gate, les règles de routage, ce que voit le reste du workflow, et comment le gate compose avec les règles d'approbation à l'échelle de l'org.
---

Un gate d'approbation est une étape de workflow dont le seul rôle est de mettre l'exécution en pause jusqu'à ce qu'un humain décide. L'étape avant le gate se termine, le gate publie une carte d'approbation au pool configuré, et l'étape après le gate ne tourne que quand un approbateur clique sur Approuver. Les Éditeurs et Développeurs configurent les gates dans le workflow ; le pool d'approbateurs décide depuis l'inbox ou en ligne dans le chat. Cette page couvre le gate comme primitif de workflow — ses états, son routage, les données qu'il porte, et comment il compose avec les règles d'approbation à l'échelle de l'org.

L'histoire à l'échelle de l'org de ce qu'est une approbation, ce qu'elle laisse, et comment les quatre sources de déclenchement diffèrent vit sur [Concepts d'approbation](/fr/platform/approvals/concepts). Les champs de configuration par règle utilisés à la fois par les gates et les règles à l'échelle de l'org vivent sur [Configurer les approbations](/fr/platform/approvals/configure). Ce qui suit est la surface spécifique au workflow.

## Ajouter un gate à un workflow

Ouvre l'éditeur de workflow et dépose une étape **Approbation** là où le gate doit s'asseoir. Le panneau de l'étape demande quatre choses : le **pool d'approbateurs** (équipe, rôle ou liste explicite), le **timeout** et l'**action de timeout** (Rejeter, Escalader, Approuver), le **titre et le corps de la carte** (ce que voit l'approbateur), et la **politique de commentaire** optionnelle (peut, doit, ne peut pas). Enregistre le workflow ; l'exécution suivante traite l'étape comme un hold.

Le titre et le corps de la carte sont rendus avec les variables du workflow dans la portée, donc tu peux construire un corps de carte comme `Envoyer un mail à {{recipient}} avec sujet "{{subject}}" ?` — l'approbateur voit les valeurs résolues, pas le template. Le même templating marche sur chaque champ texte de l'étape.

## Ce que porte le gate

Quand le gate se déclenche, Tale construit une carte d'approbation qui porte :

- Le nom du workflow et l'identifiant de l'exécution.
- Le titre et le corps de l'étape (avec les variables résolues).
- Un lien retour vers la vue d'exécution de l'exécution.
- La sortie de chaque étape précédente que l'auteur du workflow a marquée comme visible aux approbateurs.

Le levier des étapes-précédentes-visibles est sur le panneau de sortie de chaque étape précédente : coche la case pour exposer la sortie aux cartes d'approbation en aval. Les sorties non cochées sont invisibles à l'approbateur — utile quand une étape intermédiaire produit quelque chose que l'approbateur n'a pas besoin de voir.

## États et ce qui arrive à chacun

Le gate a les mêmes quatre états qu'a chaque approbation — en attente, approuvé, rejeté, expiré — et l'exécution réagit à chacun différemment.

- **en attente** — l'exécution est en pause. La vue d'exécution montre l'étape en attente ; les étapes en aval ne se déclenchent pas.
- **approuvé** — la prochaine étape dans le workflow tourne. Si plusieurs gates étaient empilés dos à dos, chacun doit approuver indépendamment.
- **rejeté** — l'exécution termine avec un enregistrement de rejet. La vue d'exécution capture le rejeteur, l'horodatage et le commentaire optionnel. Les étapes en aval ne se déclenchent jamais.
- **expiré** — l'action de timeout du gate décide ce qui arrive. Rejeter termine l'exécution ; Escalader re-route la carte vers le pool d'escalade et le gate repasse en attente ; Approuver auto-autorise et l'étape suivante tourne.

Les transitions d'état sont append-only — un gate résolu ne peut pas être rouvert. Pour relancer après un rejet, démarre une nouvelle exécution du workflow.

## Composer avec les règles à l'échelle de l'org

Un gate de workflow est l'une des quatre [sources de déclenchement d'approbation](/fr/platform/approvals/concepts). Les trois autres (écritures dans la base de connaissances, appels d'intégration, installations d'agent et de skill) peuvent aussi se déclencher dans la même exécution si les étapes du workflow touchent ces ressources. Quand plus d'une règle s'applique à la même action, le moteur les évalue toutes en parallèle et l'action est retenue jusqu'à ce que chacune approuve — voir [Configurer les approbations](/fr/platform/approvals/configure) pour les règles de composition.

La conséquence pratique : si ton étape `Envoyer un mail` de workflow est déjà gatée par une règle à l'échelle de l'org sur le courrier sortant, tu n'as pas besoin en plus d'une étape Approbation en-workflow avant. La règle à l'échelle de l'org retiendra l'action peu importe comment le workflow a essayé de l'invoquer.

## Un gate mis en pratique

Un workflow de rapport quotidien a trois étapes : un agent qui rédige un résumé, un gate Approbation routé au chef d'équipe, et une étape mail qui envoie le brouillon approuvé. Le titre du gate est `Approuver le rapport quotidien`, son corps est `Envoyer le rapport du jour à l'équipe ? Brouillon ci-dessous :`, l'étape précédente visible est le brouillon de l'agent, le timeout est 4 heures, et l'action de timeout est `Rejeter`. Si le chef d'équipe clique sur Approuver, l'étape mail se déclenche avec le brouillon comme corps ; s'il rejette, l'exécution termine et le rapport du jour n'est pas envoyé ; si 4 heures passent sans clic, l'exécution enregistre un timeout-reject et l'exécution du lendemain matin repart à zéro.

## Où cela s'inscrit

Les gates d'approbation sont la façon dont un workflow met un humain entre deux étapes automatisées. La lecture suivante naturelle est [Concepts d'automatisation](/fr/platform/automations/concepts) pour le modèle environnant — workflows, déclencheurs, étapes, exécutions — et [Concepts d'approbation](/fr/platform/approvals/concepts) pour l'histoire inter-sources de ce que chaque approbation porte.
