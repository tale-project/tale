---
title: Bibliothèque de skills
description: La bibliothèque de skills de l'organisation — des bundles de fichiers que n'importe quel agent lit à l'exécution, gardés privés ou partagés par un seul champ.
---

Un skill est une consigne que tu écris une fois et que chaque conversation et chaque agent peuvent ensuite lire. Il vit dans l'arborescence de fichiers de ton organisation sous forme d'un petit bundle : une `SKILL.md` qui porte la consigne dans son corps, plus le matériel de référence sur lequel cette consigne s'appuie. C'est sous **Paramètres > Skills** que tu parcours et lis ces bundles. La bibliothèque est en lecture seule à dessein : un bundle arrive et change par téléversement de paquet, jamais par une modification sur place — ce que tu lis ici est exactement ce qui a été livré. Supprimer un skill demande des droits Admin ou Developer.

Cette page explique ce qu'est un skill, de quel fichier il est fait, qui a le droit de le voir, et comment il arrive, se remplace et se retire. Le versant agent est sur [Skills d'agent](/fr/platform/agents/skills) : lis-le dès qu'un agent précis doit aller chercher un bundle précis.

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

## D'où viennent les skills

Chaque organisation démarre avec les skills de documents livrés, et les nouveaux bundles arrivent par téléversement : un paquet d'automatisation téléversé en zip installe les skills qu'il embarque directement dans cette bibliothèque, avec une confirmation devant chaque skill existant qu'il remplacerait. Ce chemin — et la façon dont un paquet déclare ses skills — vit sur [Ajouter des automatisations à ton organisation](/fr/platform/automations/catalog). Rien ne se rédige dans l'app : un bundle s'écrit là où vit son pack, dans des fichiers, et se livre en entier.

## Remplacer et retirer

Remplacer le contenu d'un bundle passe par ce même téléversement de paquet : un skill embarqué dont le slug existe déjà demande confirmation, puis remplace le bundle entier et garde l'ancien `SKILL.md` dans l'historique du skill. **Supprimer**, sur la page du skill, retire le bundle du disque : chaque agent lié y perd l'accès, et la liaison ne se rabat sur rien.

<Warning>

Remplacer et supprimer prennent effet immédiatement, et rien ne fige une version. Un agent lié à un skill lit toujours le bundle exactement tel qu'il est à cet instant.

</Warning>

## Ce qu'il y a dans le bundle

La page du skill affiche **Bundle** — l'arborescence telle qu'elle existe sur le disque, avec la `SKILL.md` épinglée en haut — et chaque fichier cliqué s'ouvre en lecture seule à côté de l'arbre : le code avec coloration syntaxique, le markdown rendu, et un message clair pour une image ou un binaire que le navigateur ne sait pas afficher. La `SKILL.md` elle-même se rend de la même façon — les faits du frontmatter (description, visibilité, labels) au-dessus du corps, exactement tel qu'un modèle le lit. Le skill utile le plus petit tient en un seul fichier, et la plupart grandissent un dossier à la fois.

```text
release-notes/
├── SKILL.md
├── references/
│   └── voix-et-ton.md
└── scripts/
    └── group-changes.py
```

<Frame caption="La page d'un skill — l'arborescence du bundle à gauche, le fichier sélectionné en lecture seule à droite.">

![La page de détail d'un skill avec l'arborescence du bundle, la SKILL.md épinglée, et un fichier de script ouvert dans la visionneuse en lecture seule.](/images/platform/skills-bundle-tree.webp)

</Frame>

Garde des assets courts et lisibles. Un texte qu'un modèle ouvre à peu de frais finit par servir ; un gros binaire reste là sans être lu, et la visionneuse te dit franchement qu'elle ne sait pas l'afficher.

## Où cela se place

La bibliothèque de skills est la forme de réutilisation la plus légère de Tale : un fichier, un champ pour le partage, et rien à tenir synchronisé entre les personnes concernées. C'est là qu'une formulation que tu retapes sans arrêt cesse d'être quelque chose que tu retapes. Une fois le bundle en bibliothèque, il ne reste qu'à décider quel agent ira le chercher : c'est [Skills d'agent](/fr/platform/agents/skills), qui couvre la liaison, le plafond par agent et le chemin d'un bundle jusqu'à une sandbox.
