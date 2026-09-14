---
title: Bibliothèque de skills
description: Crée des instructions réutilisables, importe un bundle et choisis les équipes et agents de projet qui pourront l’utiliser.
---

Un skill décrit une méthode de travail réutilisable : rédiger des notes de version, vérifier un brief ou préparer un document selon les conventions de ton équipe. Il contient un fichier d’instructions `SKILL.md` et, si nécessaire, des fichiers complémentaires. Entretiens-le dans **Paramètres > Skills**, puis [équipe les agents concernés](/fr/platform/agents/skills).

Chaque membre peut créer un skill et modifier les siens. Pour modifier ou supprimer le skill partagé d’une autre personne, il faut être administrateur de l’organisation.

## Créer un petit skill

<Steps>

<Step title="Nommer le skill et préciser quand l’utiliser">

Ouvre **Paramètres > Skills**, puis **Ajouter un skill > Skill vierge**. Saisis un **Nom**, par exemple `brief-summary`, et une **Description** :

```text
Résume un brief de projet en indiquant la date de relecture, le responsable
et les questions ouvertes. À utiliser pour une passation ou une vérification rapide.
```

Le nom est un identifiant unique : lettres minuscules, chiffres et tirets simples, jusqu’à 64 caractères. La description indique au modèle dans quels cas lire le skill. Clique sur **Créer** pour l’ajouter et ouvrir son éditeur.

</Step>

<Step title="Rédiger les instructions">

Sous **Instructions (corps)**, donne une procédure courte et un résultat vérifiable. Par exemple :

```markdown
Lis le brief fourni. Produis un tableau de trois lignes : date de relecture,
responsable et questions ouvertes. Cite la phrase qui justifie chaque réponse.
Écris « Non précisé » si l’information manque. Ne déduis pas une date de
lancement d’une date de relecture.
```

Ajoute des fichiers de référence lorsqu’ils aident à suivre la procédure. Place les exemples détaillés dans ces fichiers et précise quand l’agent doit les ouvrir.

</Step>

<Step title="Choisir le public et enregistrer">

Un nouveau skill a la visibilité **Organisation**. Sous **Visibilité**, choisis **Équipes** et sélectionne au moins une équipe si son contenu doit rester dans un cercle plus restreint. Ajoute une icône ou des libellés si cela facilite la recherche, puis clique sur **Enregistrer**.

Créer un skill ne l’ajoute pas automatiquement à un agent. Ouvre l’agent du projet concerné et sélectionne le skill dans son équipement. Lance une petite tâche avec des données connues, puis compare le résultat aux instructions.

</Step>

</Steps>

<Frame caption="L’éditeur réunit les fichiers du bundle, la description, les libellés et la visibilité, puis la section Instructions.">

![L’éditeur du skill docx affiche l’arborescence, la description, les libellés, la visibilité Organisation et le titre Instructions.](/images/platform/skill-library-detail.webp)

</Frame>

## Importer un bundle existant

Utilise **Ajouter un skill > Téléverser un zip** ou **Téléverser un dossier**. Le bundle doit contenir `SKILL.md` à sa racine. Des références, ressources et scripts peuvent l’accompagner :

```text
brief-summary/
├── SKILL.md
└── references/
    └── example-brief.md
```

L’aperçu présente les métadonnées, le partage, la licence et la liste des fichiers avant que **Téléverser le bundle** n’enregistre quoi que ce soit. Vérifie le contenu et le public. Sans `visibility`, le partage est ouvert à l’organisation. Si le nom existe déjà, Tale demande s’il faut remplacer le skill ; ce remplacement concerne aussi les agents qui l’utilisent.

<Warning>

L’import ne lance aucune tâche et n’exécute aucun fichier. Une fois le skill ajouté à un agent, ses instructions guident toutefois un agent de code qui peut disposer d’outils, d’identifiants et d’un shell. Examine les instructions et scripts inconnus avant de l’équiper. Un skill n’ajoute pas de barrière de permissions.

</Warning>

## Comprendre le partage

| Visibilité | Qui peut le lire | Quels agents de projet peuvent l’utiliser |
| --- | --- | --- |
| **Organisation** | Tous les membres de l’organisation | Les agents de tous les projets |
| **Équipes** | Les membres des équipes sélectionnées | Les agents des projets associés à une équipe correspondante |

L’accès du projet détermine son équipement, même si tu peux personnellement lire davantage de skills. Un projet ouvert à l’organisation peut utiliser les skills de l’organisation. Les anciens skills privés restent visibles par leur propriétaire, mais aucun agent ne peut les équiper. Les nouveaux skills privés ne sont pas acceptés.

Restreindre la visibilité demande une confirmation, car certains agents peuvent perdre l’accès. La suppression a la même conséquence pratique : une exécution qui dépend du bundle manquant ne peut plus le préparer. Vérifie les usages d’un skill partagé avant de le restreindre ou de le retirer.

## Référence du fichier

Voici un `SKILL.md` minimal :

```markdown
---
name: brief-summary
description: Résume un brief de projet. À utiliser pour les passations et vérifications.
visibility: org
---

Lis le brief. Indique la date de relecture, le responsable et les questions
ouvertes. Cite les preuves et marque les informations absentes « Non précisé ».
```

| Champ | Signification |
| --- | --- |
| `name` | Correspond au nom du dossier. `anthropic` et `claude` sont réservés. |
| `description` | Quand et pourquoi lire le skill ; 1 024 caractères maximum. |
| `visibility` / `teams` | `org`, ou `team` accompagné des identifiants d’équipes. L’interface remplit ces valeurs. |
| `license` | Les conditions d’utilisation fournies par l’auteur. |
| `recommended-packages` | Les dépendances conseillées ; l’import ne les installe pas. |
| `disable-model-invocation` | Demande un usage explicite du skill. Cette métadonnée est une instruction, pas une restriction d’accès. |
| `icon` / `labels` | La présentation dans la bibliothèque ; jusqu’à huit libellés. |

Tale conserve les clés de frontmatter inconnues. Le frontmatter est limité à 16 KB et le fichier `SKILL.md` complet à 512 KB. Les instructions lues souvent doivent rester bien plus courtes.

## Actualiser et résoudre les problèmes

Ouvre une ligne pour modifier la description, les instructions, les libellés et la visibilité. L’arborescence **Bundle** permet d’examiner les fichiers complémentaires. Les agents ne sont pas liés à une version précise : la prochaine préparation utilise le bundle courant. Teste donc les changements partagés sur une tâche représentative.

Si un agent ne trouve pas le skill, vérifie son équipement et la visibilité pour le projet. S’il ignore un skill équipé, précise dans la tâche quel skill utiliser et compare le résultat avec ses instructions. [Skills des agents](/fr/platform/agents/skills) explique comment le bundle équipé est préparé et présenté à l’agent.

En cas d’erreur d’import, vérifie que `SKILL.md` est à la racine, que son frontmatter est valide et que son nom est accepté. L’erreur précise les chemins ou limites de taille en cause. Pour retirer un bundle, ouvre-le et choisis **Supprimer le skill** après avoir vérifié les agents concernés.
