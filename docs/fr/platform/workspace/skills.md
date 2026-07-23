---
title: Bibliothèque de skills
description: La bibliothèque de skills de l'organisation — des bundles de fichiers que n'importe quel agent lit à l'exécution, gardés privés ou partagés par un seul champ.
---

Un skill est une consigne que tu écris une fois et que chaque conversation et chaque agent peuvent ensuite lire. Il vit dans l'arborescence de fichiers de ton organisation sous forme d'un petit bundle : une `SKILL.md` qui porte la consigne dans son corps, plus le matériel de référence sur lequel cette consigne s'appuie. C'est sous **Paramètres > Skills** que tu crées, téléverses et entretiens ces bundles, et il faut des droits Admin ou Developer pour le faire.

Cette page explique ce qu'est un skill, de quel fichier il est fait, qui a le droit de le voir, et comment tu en ajoutes un, le copies et le retires. Le versant agent est sur [Skills d'agent](/fr/platform/agents/skills) : lis-le dès qu'un agent précis doit aller chercher un bundle précis.

## Ce qu'un skill est, et ce qu'il n'est pas

Un skill est un **paquet de connaissances**. Son corps est une consigne qu'un modèle lit quand le travail l'appelle : une voix rédactionnelle maison, une checklist que ton équipe suit, la façon dont ton organisation formule un refus. Un modèle repère le bundle à sa description, déplie le corps quand cette description colle à la tâche, puis ouvre les fichiers du bundle là où le corps y renvoie.

Un skill n'est jamais exécuté. Un bundle ne contient ni point d'entrée, ni commande, ni environnement d'exécution : un fichier sous `scripts/` est de la matière qu'un modèle peut lire et reprendre, pas un programme que Tale lance à ta place. C'est cette frontière qui rend sans risque l'adoption d'un bundle venu d'ailleurs — tu fais entrer dans ton organisation de la prose et des fichiers de référence, rien qui puisse agir de soi-même.

## Le fichier SKILL.md

Chaque bundle contient exactement une `SKILL.md` à sa racine : un bloc de frontmatter YAML, puis le corps de la consigne en markdown.

```markdown
---
name: release-notes
description: Transforme une liste de changements fusionnés en notes de version dans notre voix maison. À utiliser quand on demande un changelog, des notes de version ou un résumé de ce qui est parti en production.
visibility: org
license: CC-BY-4.0
recommended-packages:
  python:
    - markdown-it-py
---

Rédige les notes de version en trois sections — Ajouté, Modifié, Corrigé — et
commence chaque ligne par le verbe...
```

Les clés suivent la convention agentskills.io, en kebab-case, et toute clé que Tale ne connaît pas est conservée telle quelle : un bundle écrit pour un autre outil survit donc à une modification et à un enregistrement sans rien perdre.

| Clé                        | Ce qu'elle porte                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                     | Le slug, qui doit correspondre au nom du dossier du bundle — minuscules, chiffres et traits d'union simples, 64 caractères au plus. `anthropic` et `claude` sont réservés. |
| `description`              | Jusqu'à 1024 caractères, et le champ qui décide si un modèle ira chercher le skill. Dis ce qu'il fait et quand il s'applique.                                              |
| `visibility`               | `private` ou `org`. Absent, cela compte comme `org`.                                                                                                                       |
| `owner`                    | Le membre à qui appartient le bundle. Obligatoire sur un skill `private` ; sur un skill `org`, c'est une simple attribution.                                               |
| `license`                  | Texte libre, pour un bundle que tu as importé ou que tu comptes transmettre.                                                                                               |
| `recommended-packages`     | Des paquets Python ou Node que l'auteur suggère. Purement indicatif — Tale n'installe jamais rien pour le compte d'un skill.                                               |
| `disable-model-invocation` | À `true`, un modèle ne doit pas aller chercher le skill de lui-même. Il reste disponible pour un rappel explicite.                                                         |
| `icon` et `labels`         | Un identifiant Iconify et jusqu'à huit puces, pour la carte du skill dans la bibliothèque.                                                                                 |

Deux plafonds s'appliquent : le bloc de frontmatter peut monter à 16 Ko, et la `SKILL.md` entière à 512 Ko. Les assets du bundle sortent de ce budget.

## Qui peut le voir

Le partage tient dans un champ, pas dans une table de permissions. `visibility: private` veut dire que seul l'`owner` du bundle le voit dans la bibliothèque, et c'est pour cela qu'un skill privé doit en nommer un. `visibility: org` veut dire que tous les membres le voient. Il n'y a pas de hiérarchie de portées en dessous : partager un skill, c'est une modification qui bascule `visibility` sur `org`, et le reprendre le remet sur `private`.

<Note>

Un bundle sans `visibility` du tout compte comme un skill d'organisation. Un bundle non marqué a atterri dans l'arborescence de l'organisation à dessein — un import communautaire, la copie d'un skill livré — et le traiter comme privé le rendrait invisible pour tout le monde d'un coup.

</Note>

## Ajouter un skill à la bibliothèque

Ouvre **Paramètres > Skills**. **Ajouter un skill** propose deux points de départ, et **Téléverser un skill** se trouve à côté pour un bundle que tu as déjà.

<Steps>

<Step title="Partir de zéro ou d'un modèle">

**Vierge** ne demande qu'un nom — le slug, en minuscules, chiffres et traits d'union simples — et te dépose dans un bundle vide. **À partir d'un modèle** ouvre **Nouveau skill à partir d'un modèle** : tu choisis l'un des skills livrés et tu obtiens une copie qui t'appartient.

</Step>

<Step title="Ou téléverser un bundle">

**Téléverser un skill** ouvre **Téléverser un bundle de skill**. Dépose un `.zip` contenant une `SKILL.md` à sa racine, avec les dossiers `scripts/`, `references/` ou `assets/` que tu veux. Tale lit le frontmatter avant d'écrire quoi que ce soit et te montre ce qu'il y a trouvé — la description, la licence, les paquets recommandés et le nombre de clés supplémentaires qu'il conservera. Tu valides donc un bundle que tu as réellement lu. Si le slug existe déjà, on te demande d'abord si tu veux remplacer.

</Step>

<Step title="Écrire le corps">

Ouvre le skill et rédige la consigne sous **Instructions (corps)**. C'est le texte qu'un modèle lit : écris-le comme tu briefferais un collègue — à quoi sert le skill, quand il s'applique, et à quoi ressemble un bon résultat.

</Step>

</Steps>

## Copier, remplacer, retirer

Le menu de chaque skill porte **Voir les détails**, **Dupliquer** et **Supprimer le skill** ; la vue détaillée y ajoute **Remplacer le bundle**.

**Dupliquer** dérive le bundle sous un nouveau slug — pratique pour faire varier un skill partagé sans toucher à l'original. **Remplacer le bundle** écrase le contenu sur place en gardant le slug, si bien que tout agent lié le lit dans sa nouvelle version dès la requête suivante. **Supprimer le skill** retire le bundle du disque : chaque agent lié y perd l'accès, et la liaison ne se rabat sur rien.

<Warning>

Remplacer et supprimer prennent effet immédiatement, et rien ne fige une version. Un agent lié à un skill lit toujours le bundle exactement tel qu'il est à cet instant.

</Warning>

## Ce qu'il y a dans le bundle

La vue détaillée affiche **Bundle** — l'arborescence telle qu'elle existe sur le disque — avec une visionneuse pour chaque fichier que tu ouvres. Le skill utile le plus petit tient en un seul fichier, et la plupart grandissent un dossier à la fois.

```text
release-notes/
├── SKILL.md
├── references/
│   └── voix-et-ton.md
└── scripts/
    └── group-changes.py
```

Garde des assets courts et lisibles. Un texte qu'un modèle ouvre à peu de frais finit par servir ; un gros binaire reste là sans être lu, et la visionneuse te dit franchement qu'elle ne sait pas l'afficher. **Modifications récentes**, dans la même vue, est la piste d'audit du bundle — qui l'a téléversé, dupliqué, modifié ou supprimé, et quand. C'est le premier endroit où regarder quand un skill se met à se comporter autrement que la dernière fois.

## Où cela se place

La bibliothèque de skills est la forme de réutilisation la plus légère de Tale : un fichier, un champ pour le partage, et rien à tenir synchronisé entre les personnes concernées. C'est là qu'une formulation que tu retapes sans arrêt cesse d'être quelque chose que tu retapes. Une fois le bundle en bibliothèque, il ne reste qu'à décider quel agent ira le chercher : c'est [Skills d'agent](/fr/platform/agents/skills), qui couvre la liaison, le plafond par agent et le chemin d'un bundle jusqu'à une sandbox.
