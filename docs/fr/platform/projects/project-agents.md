---
title: Agents de projet
description: Agents scopés au Projet versus agents d'organisation — quand opter pour chaque, comment les agents de Projet supplantent les agents d'organisation dans le sélecteur, et comment fonctionne la publication dans un Projet.
---

Un agent de Projet est un agent qui n'existe qu'à l'intérieur du Projet. Il apparaît dans le sélecteur d'agents du chat pour les membres du Projet, et nulle part ailleurs ; il hérite automatiquement des Files et Instructions du Projet ; supprimer le Projet le supprime. Va vers des agents de Projet quand un agent a besoin d'instructions spécifiques au Projet qu'un agent générique d'organisation ne devrait pas porter.

Cette page couvre la différence entre agents de Projet et agents d'organisation, la règle d'ombre qui décide lequel apparaît quand les deux partagent un nom, et comment la publication change entre les deux portées.

## Agents de Projet versus agents d'organisation

Un **agent d'organisation** vit dans la liste [Agents](/fr/platform/admin/agents) de l'organisation et apparaît dans n'importe quel chat auquel l'utilisateur a accès. Un **agent de Projet** ne vit que dans le Projet ; en dehors, il n'existe pas. Les formes sont les mêmes — mêmes instructions, connaissances, outils, modèle — seule la visibilité diffère.

## La règle d'ombre

Les agents de Projet et les agents d'organisation peuvent partager un nom. Quand ils le font, à l'intérieur du Projet **c'est l'agent de Projet qui l'emporte** — il supplante l'agent d'organisation dans le sélecteur. En dehors du Projet, c'est l'agent d'organisation qui apparaît. Ça permet à une équipe de prendre un agent à l'échelle de l'organisation (« Sales assistant ») et de le surcharger pour un compte précis avec des instructions supplémentaires, sans le renommer.

## Publier dans un Projet

Créer un agent depuis l'intérieur du Projet produit automatiquement un agent de Projet. En créer un depuis la liste **Agents** de l'organisation produit un agent d'organisation auquel n'importe quel Projet peut choisir d'accéder. Pour déplacer un agent d'organisation dans un Projet, duplique-le dans l'onglet Agents du Projet — l'original reste à l'échelle de l'organisation ; le duplicata devient un agent de Projet que l'équipe peut éditer sans toucher à la copie d'organisation.

## Permissions

Les agents de Projet suivent l'adhésion au Projet. Les membres du Projet peuvent les exécuter ; les Éditeurs du Projet peuvent les éditer ; le propriétaire du Projet peut les supprimer. Les rôles Éditeur et Développeur au niveau organisation n'ont pas automatiquement accès aux agents d'un Projet — l'adhésion au Projet est le seul chemin d'entrée.

## Quand opter pour chacun

| Utilise … quand                                                    | Agent de Projet | Agent d'organisation |
| ------------------------------------------------------------------ | --------------- | -------------------- |
| Les instructions sont spécifiques aux données de ce Projet         | ✓               |                      |
| Le même prompt serait utile à chaque équipe                        |                 | ✓                    |
| Tu veux une variante ponctuelle d'un agent d'organisation existant | ✓               |                      |
| Tu veux partager un agent à travers plusieurs Projets              |                 | ✓                    |

## Où ça s'inscrit

Les agents de Projet sont la réponse à « on adore cet agent mais il doit se comporter autrement pour ce client ». La section [Agents](/fr/platform/agents/concepts) plus large est à l'échelle de l'organisation ; va vers elle quand le public est tout le monde. La suite naturelle est [Utiliser les projets](/fr/tutorials/member/use-projects), qui parcourt un Projet qui finit avec un agent de Projet qui fait un vrai travail.
