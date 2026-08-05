---
title: Bibliothèque de skills
description: La page Paramètres > Skills — des bundles de fichiers que tes agents lisent, créés par n'importe quel membre et partagés avec des équipes ou avec toute l'organisation.
---

Un skill est une consigne que tu écris une fois et que chaque agent peut ensuite lire. Il vit dans l'arborescence de fichiers de ton organisation sous forme d'un petit bundle : une `SKILL.md` qui porte la consigne dans son corps, plus le matériel de référence sur lequel cette consigne s'appuie. **Paramètres > Skills** est l'endroit où tu crées, téléverses et entretiens ces bundles. Chaque membre peut créer des skills ; ce que tu peux modifier se décide bundle par bundle.

Cette page couvre ce qu'est un skill, le fichier dont il est fait, qui le voit, et comment tu en ajoutes ou en retires un. Lis le côté agent sur [Les skills sur les agents](/fr/platform/agents/skills) dès qu'un agent doit aller chercher un bundle précis.

## Ce qu'est un skill, et ce qu'il n'est pas

Un skill est un **paquet de connaissances**. Son corps est une consigne qu'un modèle lit quand le travail le demande : une voix maison pour l'écriture, une checklist que ton équipe suit, la façon dont ton organisation formule un refus. Un modèle trouve le bundle par sa description, lit le corps quand cette description correspond à la tâche, et ouvre les fichiers du bundle quand le corps pointe vers eux.

Un skill n'est jamais quelque chose que la plateforme exécute. Un bundle n'a ni point d'entrée, ni commande, ni runtime — un fichier sous `scripts/` est du matériel qu'un modèle peut lire et adapter, pas un programme que Tale lance pour toi. C'est cette limite qui rend un bundle acceptable venu de l'extérieur : importer le skill de quelqu'un d'autre apporte à ton organisation de la prose et des fichiers de référence, et rien qui puisse agir tout seul.

## Le fichier SKILL.md

Chaque bundle a exactement une `SKILL.md` à sa racine — un frontmatter YAML, puis le corps de la consigne en markdown.

```markdown
---
name: release-notes
description: Transforme une liste de changements mergés en notes de version dans notre voix maison. À utiliser quand on demande un changelog, des notes de version ou un résumé de ce qui a été livré.
visibility: team
teams:
  - jx7d…
license: CC-BY-4.0
---

Écris les notes de version en trois sections — Added, Changed, Fixed — et
commence chaque ligne par le verbe...
```

Les clés suivent la convention agentskills.io en kebab-case, et toute clé que Tale ne reconnaît pas est conservée telle quelle : un bundle écrit pour un autre outil survit à une édition et un enregistrement sans changer.

| Clé                        | Ce qu'elle porte                                                                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                     | Le slug, qui doit être égal au nom du dossier du bundle — lettres minuscules, chiffres et tirets simples, 64 caractères au plus. `anthropic` et `claude` sont réservés. |
| `description`              | Jusqu'à 1024 caractères — le champ qui décide si un modèle va chercher le skill. Dis ce qu'il fait et quand il s'applique.                                              |
| `visibility`               | `team` ou `org`. Absente, elle vaut `org`. `private` est retiré — un bundle qui le porte déjà se lit encore, mais aucun nouveau skill ne le prend.                      |
| `teams`                    | Les ids des équipes avec lesquelles un skill `team` est partagé — obligatoire là, rejeté ailleurs. Le sélecteur de partage de la bibliothèque le remplit pour toi.      |
| `owner`                    | Le membre à qui appartient le bundle — de l'attribution sur un skill partagé, obligatoire sur un ancien skill `private`.                                                |
| `license`                  | Texte libre, pour un bundle importé ou que tu comptes transmettre.                                                                                                      |
| `recommended-packages`     | Des paquets Python ou Node que l'auteur suggère. Purement indicatif — Tale n'installe jamais rien au nom d'un skill.                                                    |
| `disable-model-invocation` | À `true`, un modèle ne doit pas aller chercher le skill de lui-même. Il reste disponible pour un rappel explicite.                                                      |
| `icon` et `labels`         | Un id Iconify et jusqu'à huit puces, pour la carte du skill dans la bibliothèque.                                                                                       |

Deux plafonds s'appliquent : le frontmatter peut atteindre 16 Ko, et la `SKILL.md` entière 512 Ko. Les assets du bundle vivent hors de ce budget.

## Qui le voit

Le partage tient dans un champ, pas dans une table de permissions. `visibility: team` partage le bundle avec les équipes listées sous `teams` ; choisis-les dans la section **Visibilité** de la bibliothèque. `visibility: org` signifie que chaque membre le voit et que les agents de n'importe quel projet peuvent l'équiper. N'importe quel membre peut partager un skill avec des équipes ou toute l'organisation ; modifier ou supprimer le skill partagé de quelqu'un d'autre demande un admin de l'organisation. Un bundle sans aucune `visibility` — y compris celui que tu téléverses — compte comme un skill d'organisation, et l'aperçu du téléversement te le dit avant que tu confirmes.

<Note>

`visibility: private` est retiré. Les agents sont la seule surface qui équipe des skills, et les agents d'un projet ne voient jamais le bundle privé d'un seul membre — un skill privé ne serait donc visible que pour toi et utilisable nulle part. Un bundle qui porte déjà cette valeur continue de fonctionner pour son propriétaire (même un admin ne le lit pas), et son propriétaire peut élargir le partage à tout moment ; les nouveaux skills et les téléversements qui déclarent `private` sont refusés.

</Note>

Restreindre le partage d'un skill — d'organisation à équipe, ou retirer une équipe — demande d'abord confirmation : qui perd le skill de vue le perd aussi dans chaque agent qui l'équipait à travers lui.

## Ajouter un skill à la bibliothèque

Ouvre **Paramètres > Skills**. La page est un tableau de tous les skills que tu peux voir — nom, description, visibilité et libellés — avec une recherche qui couvre le nom, la description et les libellés, et des filtres pour la visibilité et le libellé. Un clic sur une ligne ouvre le bundle. **Ajouter un skill** propose trois points de départ.

<Steps>

<Step title="Partir de zéro">

**Skill vierge** demande un nom — le slug, en lettres minuscules, chiffres et tirets simples — plus la description et le partage, et un corps de consigne que tu écris sur place. Un nouveau skill démarre partagé avec l'organisation ; restreins le partage aux équipes quand le savoir leur appartient.

</Step>

<Step title="Ou téléverser un bundle">

**Téléverser un zip** prend un `.zip` avec `SKILL.md` à la racine, à côté de dossiers comme `scripts/`, `references/` ou `assets/` ; **Téléverser un dossier** prend le dossier lui-même et le zippe pour toi. Dans les deux cas, Tale lit le frontmatter avant d'écrire quoi que ce soit et te montre ce qu'il a trouvé — la description, le partage avec lequel le bundle arrivera, la licence et la liste complète des fichiers avec leurs tailles. Tu approuves donc un bundle que tu as réellement vu. Si le slug existe déjà, Tale demande d'abord si tu veux remplacer.

</Step>

<Step title="Écrire le corps">

Ouvre le skill et écris la consigne sous **Instructions (corps)**. C'est le texte que le modèle lit — écris-le comme tu brieferais une collègue : à quoi sert le skill, quand il s'applique, et à quoi ressemble un bon résultat.

</Step>

</Steps>

## Ce que contient le bundle

La vue détaillée d'un skill montre **Bundle** — l'arborescence telle qu'elle existe sur le disque — avec un visualiseur pour chaque fichier que tu cliques. Le plus petit skill utile tient dans un seul fichier ; la plupart grandissent dossier par dossier.

```text
release-notes/
├── SKILL.md
├── references/
│   └── voice-and-tone.md
└── scripts/
    └── group-changes.py
```

Garde les assets petits et lisibles. Un texte qu'un modèle ouvre à peu de frais sert ; un gros binaire reste là sans être lu, et le visualiseur dit franchement qu'il ne peut pas l'afficher.

## Retirer un skill

**Supprimer le skill** dans la vue détaillée retire le bundle du disque ; chaque agent qui l'équipait perd l'accès, sans solution de repli. Il n'y a pas d'épinglage de version — un skill est toujours lu exactement tel qu'il est maintenant, et c'est aussi ce qui le rend précieux : une modification atteint tout le monde.

## Où cela s'inscrit

La bibliothèque de skills est la réutilisation la plus légère que Tale offre : un fichier, un champ pour le partage, rien à garder synchronisé entre les personnes qui en ont besoin. C'est là qu'une formulation que tu retapes sans arrêt cesse d'être quelque chose que tu retapes. Une fois le bundle dans la bibliothèque, reste à décider quels agents le reçoivent — c'est [Les skills sur les agents](/fr/platform/agents/skills) : équiper les agents d'un projet et le chemin d'un bundle vers la sandbox.
