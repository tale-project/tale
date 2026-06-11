---
title: Compétences d'agent
description: Une compétence est un bundle réutilisable d'instructions et d'un script sandbox optionnel que tu attaches à un agent. Cette page donne le modèle mental pour choisir une compétence plutôt que de modifier les instructions de l'agent.
---

Une compétence est l'unité vers laquelle Tale se tourne quand le même motif apparaît sur plusieurs agents. C'est un bundle réutilisable — un morceau d'instructions et, optionnellement, un script sandbox que l'agent peut appeler — que tu attaches à un agent comme tu attaches un outil. Les Éditeurs et les Développeurs publient des compétences au niveau de l'organisation ; les agents choisissent dans la bibliothèque de compétences de l'organisation.

Cette page te donne le modèle mental pour quand une compétence est le bon coup et quand les instructions inline le sont. Lis-la avant de publier ta première compétence ; reviens-y quand les instructions d'un agent s'allongent et que tu te demandes si la bonne réponse est de les scinder en une compétence.

## Ce que regroupe une compétence

Une compétence porte deux choses :

- **Instructions** — de la prose qui encadre un comportement spécifique. Les instructions de la compétence s'ajoutent à celles de l'agent à la requête ; l'agent lit les deux comme un seul long prompt.
- **Un script optionnel** — du code qui tourne dans le sandbox quand l'agent appelle la compétence comme outil. Les entrées et sorties du script sont typées ; l'agent passe du JSON, la compétence retourne du JSON.

Une compétence d'instructions pures est la bonne forme quand le comportement est voix ou contrainte — « cite toujours la source par numéro de section », « refuse les questions hors de ce produit ». Une compétence avec script est la bonne forme quand le comportement est un calcul, une transformation ou une tâche multi-étapes que le modèle devrait sinon mimer en tokens.

## Attacher à un agent

Une compétence devient visible pour un agent par attachement. L'éditeur de l'agent liste les compétences disponibles de l'organisation sous l'onglet **Compétences** ; coche celles qui s'appliquent. Les compétences attachées injectent toujours leurs instructions ; une compétence avec script apparaît aussi dans la liste d'outils de l'agent, qu'il peut choisir d'appeler.

L'attachement est par agent : deux agents peuvent attacher la même compétence et le comportement de l'agent est l'union de ses instructions et de celles de la compétence. Le détachement est symétrique — la requête suivante tourne sans la compétence.

## Scripts de compétence et le sandbox

Les scripts de compétence tournent dans le même sandbox que l'outil **Exécuter du code** : Python ou Node, paquets autorisés déclarés par compétence, installations de paquets régies par la [politique run-code](/fr/platform/admin/governance/run-code-policy) de l'organisation. La sortie réseau du sandbox est ouverte par défaut ; les opérateurs auto-hébergés peuvent la restreindre au niveau du déploiement. Le contrat du script est une entrée typée et une sortie typée ; ce qui tourne entre les deux est à toi.

La frontière de confiance est nette. Un script de compétence peut être invoqué par n'importe quel agent auquel il est attaché. Traite la publication d'une compétence comme l'élargissement de la surface de confiance de chaque agent qui la prend ; la [politique de gouvernance sur run-code](/fr/platform/admin/governance/run-code-policy) régit quels paquets le script peut installer.

## Versionnage

Les compétences sont versionnées. Enregistrer une compétence crée une nouvelle version ; l'agent qui attache la compétence se fige sur une version spécifique. Mettre à jour une compétence ne propage pas automatiquement — les agents prennent la nouvelle version à l'enregistrement. C'est intentionnel : une compétence est un contrat, et versionner le contrat est ainsi qu'on tient le contrat.

## Quand y recourir

| Utilise … quand                                                               | Compétence | Instructions inline |
| ----------------------------------------------------------------------------- | ---------- | ------------------- |
| Le motif se répète sur plusieurs agents                                       | ✓          |                     |
| Le comportement implique un script que le modèle mimerait sinon               | ✓          |                     |
| Le comportement est la voix d'un agent                                        |            | ✓                   |
| Tu veux que l'organisation régisse le comportement par une seule modification | ✓          |                     |
| Les instructions de l'agent tiennent encore sur un écran                      |            | ✓                   |

Les instructions inline sont la bonne forme pour un agent. Les compétences sont la bonne forme quand le même comportement apparaît dans deux ou trois agents et que le coût de maintenance pour garder leurs instructions inline synchronisées commence à mordre.

## Construis-en une

Les compétences sont le niveau d'abstraction au-dessus des quatre boutons — elles te laissent livrer un comportement une fois et le faire prendre par chaque agent qui en a besoin par attachement. La marche suivante naturelle est [Construire un outil sur mesure](/fr/tutorials/developer/build-a-custom-tool) — elle parcourt la publication d'une compétence avec script depuis une page vierge jusqu'à l'attachement à un agent.
