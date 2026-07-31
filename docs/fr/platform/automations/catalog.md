---
title: Ajouter des automatisations à ton organisation
description: D’où viennent les automatisations — les packs livrés avec chaque organisation, les brouillons créés sur le canvas, et les paquets téléversés, y compris les zips qui installent les skills qu’ils embarquent.
---

La page **Automatisations** de la barre latérale liste chaque automatisation de l’organisation et sert de porte d’entrée aux nouvelles. Une organisation démarre avec les packs livrés déjà en place, tu peux en créer une de zéro sur son canvas, et **Téléverser un paquet** accepte un pack construit ailleurs — sous forme de fichiers, ou d’un seul zip qui installe aussi les bundles de skills que le pack embarque. Gérer la page demande les permissions Propriétaire, Admin ou Développeur ; tout ce qu’un téléversement crée reste un brouillon jusqu’au déploiement — rien de ce qui tourne ne change parce qu’un fichier a atterri.

Cette page couvre la provenance des automatisations et ce qu’un paquet téléversé peut contenir. En piloter une — canvas, versions, exécutions de test, déploiement — vit sur [L’éditeur de workflow](/fr/platform/automations/editor) ; le modèle sous-jacent sur [Concepts d’automatisation](/fr/platform/automations/concepts) ; ce que font les packs livrés sur [Automatisations livrées](/fr/platform/automations/builtin).

<Frame caption="La page Automatisations — chaque ligne est une automatisation avec son nombre de versions et la version en service, ou Pas en service.">

![La page Automatisations listant les automatisations e-mail et GitHub livrées, chaque ligne avec son nombre de versions et son état de déploiement.](/images/platform/automations-catalog.webp)

</Frame>

## Ce que montre la liste

Chaque ligne est une automatisation : son nom, son nombre de versions, et soit la version en service, soit **Pas en service**. La page de l’org liste les automatisations au niveau de l’organisation ; une automatisation qui appartient à un projet vit dans l’onglet **Automatisations** de ce projet — l’endroit où elle apparaît se décide une fois, à son premier enregistrement, et ne bouge plus. Clique une ligne pour arriver sur la page de l’automatisation, que décrit [L’éditeur de workflow](/fr/platform/automations/editor).

**Nouvelle automatisation** crée un brouillon vide à construire sur le canvas. Les packs livrés ne demandent aucune installation : chaque organisation en est équipée à sa création, prêts à déployer.

## Téléverser un paquet

Un pack est un dossier : `workflow.yml` (le document de l’automatisation — requis), `automation.yml` (le manifeste — optionnel) et, quand le pack apporte son propre savoir, un dossier par skill sous `skills/`.

```text
review-invoices/
├── workflow.yml
├── automation.yml
└── skills/
    └── invoice-rules/
        ├── SKILL.md
        └── references/
            └── levy-rates.md
```

Pour téléverser, ouvre **Automatisations**, choisis **Téléverser un paquet** dans le menu **Nouvelle automatisation**, puis l’une des deux formes du même pack :

- **Les fichiers** — `workflow.yml`, plus `automation.yml` si le pack en fournit un. Le bon choix pour un pack qui n’est que son document.
- **Un seul `.zip` du dossier du pack** — obligatoire quand le pack embarque des skills, puisque seul le zip peut porter leurs dossiers. Les notes Markdown hors de `skills/` (un README, par exemple) sont ignorées, tout comme les dotfiles et les résidus de build (`__pycache__/`, `node_modules/`) — alors zippe le dossier tel quel, même juste après avoir lancé les tests. Le zip reste sous 20 MiB.

Choisis avant d’envoyer où l’automatisation s’installe — l’organisation, ou un projet. Le choix n’est pas définitif : installer dans un projet lie l’automatisation à ce projet, et le panneau **Projets** de sa page gère l’ensemble ensuite — lie d’autres projets, ou aucun pour qu’elle serve toute l’organisation.

<Frame caption="Téléverser un paquet d’automatisation — les fichiers ou un zip, et la surface à laquelle l’automatisation est liée.">

![Le dialogue de téléversement de paquet avec sa zone de dépôt et le sélecteur Installer dans réglé sur Organisation.](/images/platform/automations-upload-dialog.webp)

</Frame>

Le serveur valide avant d’enregistrer quoi que ce soit. Le document passe par la même validation moteur que l’éditeur — un téléversement qui ne tournerait pas est refusé avec les messages du moteur, pas enregistré cassé — et les blocs `subjects` et `settings` du manifeste deviennent le contrat de tâches et les [formulaires de paramètres](#paramètres-déclarés-par-le-pack) de l’automatisation, exactement comme le ferait un enregistrement depuis le canvas. Ce qui atterrit est une **version brouillon** derrière la barrière de déploiement habituelle : aucun déclencheur ne tourne avant que tu la déploies depuis la page de l’automatisation.

Téléverser à nouveau le pack d’une automatisation existante ajoute la version suivante — le store n’écrase jamais l’historique, chaque version antérieure reste exactement où elle était. Choisir un projet comme cible lie aussi l’automatisation existante à ce projet, en plus de ceux qu’elle sert déjà.

## Les skills que le paquet embarque

Un zip peut livrer les skills sur lesquels son document s’appuie — les bundles qu’un nœud agent charge ou depuis lesquels une étape de script tourne. Le manifeste doit les nommer, et la déclaration se vérifie dans les deux sens : un dossier `skills/` que le manifeste ne déclare pas refuse le téléversement, tout comme un slug déclaré que le zip n’apporte pas.

```yaml
# automation.yml
name: Review invoices
skills:
  - invoice-rules
subjects:
  task:
    # …le contrat de tâches, inchangé
```

Chaque bundle embarqué est validé comme un vrai skill — frontmatter parsé, `name` égal à son dossier — et installé dans la [bibliothèque de skills](/fr/platform/workspace/skills) de l’organisation dès que le téléversement est accepté ; les exécutions de test du brouillon les trouvent donc déjà. Ce qui arrive par slug dépend de ce que la bibliothèque tient déjà :

- **Slug nouveau** — le bundle est installé.
- **Bundle identique** — rien n’est écrit ; le téléversement le signale inchangé.
- **Contenu différent** — le téléversement s’arrête et liste les slugs en collision. Confirme pour les remplacer par les versions du paquet ; l’ancien `SKILL.md` reste dans l’historique de chaque skill. Rien — ni l’automatisation, ni aucun skill — n’est écrit avant ta confirmation.

Un document qui référence un skill que le paquet n’embarque pas et que la bibliothèque ne tient pas se téléverse quand même — la référence manquante revient en avertissement, pour qu’un pack puisse nommer un skill que tu installeras plus tard.

## Paramètres déclarés par le pack

Quand une automatisation lit à chaque exécution une configuration qui appartient à l’opérateur — l’identité légale d’un client, une politique de conversion —, le manifeste peut la déclarer comme **formulaires de paramètres**. La plateforme les affiche dans le dialogue de création du tableau des tâches et enregistre chaque formulaire comme fichier YAML plat dans un dossier du projet : personne n’édite un fichier à la main pour configurer l’automatisation, et chaque projet garde ses propres valeurs.

```yaml
# automation.yml
settings:
  folder: Setup
  forms:
    - file: fx-policy.yaml
      title: FX conversion policy
      required: true
      fields:
        - key: method
          label: FX conversion method
          type: select
          default: cda_monthly
          options:
            - value: cda_monthly
              label: CDA monthly average (standard)
```

Un formulaire possède son fichier : enregistrer réécrit `Setup/fx-policy.yaml` entièrement à partir des valeurs du formulaire, et le formulaire se préremplit avec ce que contient le fichier — qu’il l’ait écrit lui-même ou que quelqu’un l’ait déposé à la main. Les champs sont `text`, `number`, `boolean` ou `select` ; chaque valeur est stockée comme chaîne, un champ `text` peut imposer un `pattern`, et les titres, libellés, textes d’aide et noms d’options se localisent via des blocs `i18n` sur chaque entrée. Tout ce qui dépasse un fichier clé-valeur plat — blocs imbriqués, listes — va dans un fichier séparé, tenu à la main, que le workflow lit à côté.

Marque un formulaire `required: true` et le dialogue de création l’impose par projet : la première fois que quelqu’un choisit le modèle de tâche de l’automatisation dans un projet pas encore configuré, les formulaires apparaissent avant le champ de la tâche, et la création ne continue qu’une fois qu’ils sont enregistrés. Ensuite, le bouton **Paramètres** du même dialogue rouvre les formulaires pour les modifier — chacun avec son propre **Enregistrer**, actif seulement quand quelque chose a changé.

## Livrables déclarés par le pack

Un pack dont les exécutions déposent des documents dans le dossier d'une tâche
peut nommer lesquels sont les **livrables** — ce pour quoi quelqu'un ouvre la
tâche. La zone Résultat de la tâche liste exactement ceux-là, toujours ouverte et
dans l'ordre déclaré, tandis que tout le reste du dossier — les fichiers déposés,
les fichiers de travail de l'exécution — se replie sous **Fichiers**.

```yaml
# automation.yml
subjects:
  task:
    outcome:
      files:
        - return.xml
        - report.md
        - journal.csv
```

Seul le pack sait lesquels de ses fichiers écrits sont l'essentiel : la
plateforme ne devine rien. Un nom qu'aucune exécution n'a encore déposé apparaît
quand même comme une ligne promise marquée _Pas encore prêt_ — la tâche nomme donc
ce qu'elle produira avant de le produire. Les jokers `*` et `?` sont acceptés
(`return-*.xml`) pour un nom qu'une exécution construit. Ne déclare rien et la
zone Résultat retombe sur tous les fichiers déposés par les exécutions, le plus
récent d'abord.

## Où cela s’insère

Les automatisations arrivent par trois chemins — livrées avec l’organisation, créées sur le canvas, ou téléversées en pack — et chaque chemin finit au même endroit : une version brouillon sur la page de l’automatisation, déployée quand tu le décides. Un téléversement en zip alimente aussi la [bibliothèque de skills](/fr/platform/workspace/skills) avec les bundles dont l’automatisation a besoin, avec une confirmation devant chaque skill qu’il remplacerait. [L’éditeur de workflow](/fr/platform/automations/editor) est la lecture suivante pour mettre ce brouillon en service.
