---
title: Créer ou importer une automatisation
description: Choisis un point de départ, importe un paquet validé et prépare ses skills, paramètres et livrables avant la mise en service.
---

Ouvre **Automatisations** pour retrouver les workflows de ton organisation. Les rôles Propriétaire, Admin et Développeur peuvent les gérer. Commence par vérifier si une [automatisation fournie](/fr/platform/automations/builtin) répond au besoin. Sinon, crée un brouillon que tu pourras tester avant sa mise en service.

<Frame caption="La page Automatisations — chaque ligne est une automatisation avec son nombre de versions et la version en service, ou Pas en service.">

![La page Automatisations listant les automatisations e-mail et GitHub livrées, chaque ligne avec son nombre de versions et son état de déploiement.](/images/platform/automations-catalog.webp)

</Frame>

## Choisir un point de départ

Chaque ligne indique le nom, les projets associés, le nombre de versions et la version en service, ou **Pas en service**. Ouvre-la pour examiner le workflow et ses exécutions. Le panneau **Projets** détermine les boards qui peuvent l’utiliser ; sans association à un projet, elle sert l’organisation.

Le menu **Nouvelle automatisation** propose trois parcours :

| Choix | À utiliser si… | Suite du parcours |
| --- | --- | --- |
| **À partir d’un objectif** | tu connais le résultat attendu, mais souhaites de l’aide pour organiser les étapes. | Le builder prépare un workflow à examiner. |
| **Vierge (trigger + agent)** | tu souhaites configurer le workflow toi-même. | Nomme-le, choisis le modèle, puis complète les instructions et les équipements dans l’éditeur. |
| **Téléverser un paquet** | tu disposes d’un fichier de workflow ou d’un pack réutilisable. | Tale valide les fichiers et enregistre une version brouillon. |

Les automatisations fournies sont installées à la création de l’organisation. Elles demandent encore leur configuration et une version en service avant un usage automatique. [L’éditeur de workflows](/fr/platform/automations/editor) explique comment tester les données, examiner les résultats et mettre la version choisie en service.

## Importer un paquet

Un pack contient le fichier obligatoire `workflow.yml`, un manifeste `automation.yml` facultatif et, si nécessaire, des bundles de skills :

```text
review-invoices/
├── workflow.yml
├── automation.yml
└── skills/
    └── invoice-rules/
        ├── SKILL.md
        └── references/
            └── checklist-rules.md
```

<Steps>

<Step title="Sélectionner les fichiers">

Choisis **Nouvelle automatisation > Téléverser un paquet**. Ajoute le workflow et son manifeste éventuel comme fichiers séparés, ou sélectionne une seule archive `.zip` du pack. Les skills exigent l’archive ; téléverse-la seule. Les notes Markdown hors de `skills/`, les fichiers cachés et les résidus de compilation comme `node_modules/` ou `__pycache__/` sont ignorés.

</Step>

<Step title="Choisir la destination">

Sous **Installer dans**, sélectionne **Organisation** ou un projet existant. Un manifeste déclarant `scope: project` exige un projet. Importer une automatisation existante dans un autre projet ajoute cette association sans retirer les précédentes. Le panneau **Projets** permet ensuite de modifier l’ensemble des associations.

<Frame caption="Téléverser un paquet — les fichiers ou un zip, et où l’automatisation s’installe.">

![Le dialogue de téléversement de paquet avec sa zone de dépôt et le sélecteur Installer dans réglé sur Organisation.](/images/platform/automations-upload-dialog.webp)

</Frame>

</Step>

<Step title="Valider et enregistrer">

Choisis **Téléverser le paquet** et corrige les problèmes signalés dans le workflow, le manifeste ou les skills. La validation précède l’écriture de l’automatisation et des skills fournis. Un nouvel import de la même automatisation ajoute une version brouillon et conserve l’historique.

</Step>

<Step title="Examiner avant la mise en service">

Choisis **Plus tard** pour ouvrir et tester le brouillon dans l’éditeur. Le dialogue de réussite permet aussi de mettre directement la version numérotée en service. Le téléversement seul ne change pas la version active. Configure les identifiants nécessaires et examine les skills avant le déploiement.

</Step>

</Steps>

L’archive ne doit dépasser 20 MiB ni compressée ni décompressée, avec au plus 500 fichiers, 2 MiB par fichier et 20 bundles de skills. Si elle est trop volumineuse, retire les artefacts générés et sépare les contenus indépendants en plusieurs skills. Une compression plus forte ne réduit pas la taille décompressée.

## Résoudre les conflits de skills

La liste `skills` du manifeste doit correspondre aux dossiers fournis sous `skills/`. Un dossier non déclaré ou un bundle déclaré mais absent fait refuser l’import. Chaque bundle exige des métadonnées valides dans `SKILL.md`, avec un `name` identique au nom du dossier.

```yaml
# automation.yml
name: Review invoices
skills:
  - invoice-rules
```

Les nouveaux bundles rejoignent la [bibliothèque de skills](/fr/platform/workspace/skills) de l’organisation ; les bundles identiques restent inchangés. Un contenu différent suspend l’import et affiche les slugs concernés. Examine-les avant de confirmer : le paquet remplace ces bundles partagés, tandis que l’ancien `SKILL.md` reste dans leur historique. Aucune automatisation ni aucun skill n’est écrit avant cette confirmation.

Le workflow peut aussi appeler des skills de la bibliothèque qu’il ne fournit pas. Si l’un manque, l’import affiche un avertissement. Installe un bundle accessible avant de lancer l’agent qui en dépend. L’enregistrement d’un brouillon ne prouve pas que toutes ses dépendances sont prêtes.

## Configurer un projet avec les formulaires du paquet

Le manifeste peut définir des formulaires qui apparaissent à la sélection du modèle de tâche. Les valeurs appartiennent au projet : deux projets peuvent donc employer la même automatisation avec des règles différentes.

```yaml
# automation.yml
settings:
  folder: Setup
  forms:
    - file: validation-policy.yaml
      title: Validation policy
      required: true
      fields:
        - key: method
          label: Validation profile
          type: select
          default: strict_rules
          options:
            - value: strict_rules
              label: Strict checklist
```

Si le projet n’est pas encore configuré, les formulaires obligatoires précèdent les champs de la tâche. **Enregistrer et continuer** les écrit puis reprend la création. **Paramètres** les rouvre ensuite sous forme d’onglets. Un point signale les modifications non enregistrées ; **Enregistrer** écrit tous les formulaires modifiés. Fermer avec des changements en attente demande confirmation.

L’enregistrement remplace le fichier YAML plat du formulaire, par exemple `Setup/validation-policy.yaml`. Les valeurs existantes préremplissent le formulaire, y compris celles d’un fichier téléversé manuellement. Les types admis sont `text`, `number`, `boolean` et `select` ; les valeurs sont stockées comme chaînes. Un champ texte peut imposer un `pattern`. Des blocs `i18n` par entrée traduisent titres, libellés, aide et options. Place les listes et structures imbriquées dans des fichiers séparés que le workflow lira en complément.

## Fournir des références dans un formulaire de fichiers

Un formulaire de fichiers gère directement un dossier au lieu de produire du YAML :

```yaml
settings:
  folder: Setup
  forms:
    - kind: uploads
      title: Reference documents
      subdir: reference
      accept: ['.pdf', '.json']
      match: '\.(pdf|json)$'
      requireFolder: true
```

`subdir` désigne un sous-dossier des paramètres. `accept` limite les extensions proposées par le sélecteur ; `match` filtre les noms sans distinguer la casse et refuse les fichiers qui ne figureraient pas dans la liste. Avec `requireFolder: true`, choisis ou crée d’abord un sous-dossier, par exemple pour chaque période de rapport.

Les téléversements s’appliquent immédiatement, sans bouton **Enregistrer**, et ne bloquent jamais la création d’une tâche. Les exécutions lisent le contenu actuel du dossier. Termine donc la préparation des références avant de lancer le travail qui en dépend.

## Définir les livrables attendus

Le manifeste peut nommer les fichiers de la zone **Résultat** de la tâche. Ils restent dans l’ordre déclaré ; les autres pièces jointes et fichiers de travail sont regroupés sous **Fichiers**.

```yaml
subjects:
  task:
    outcome:
      files:
        - return.xml
        - report.md
        - name: audit-summary.md
          optional: true
```

Un fichier obligatoire apparaît comme **Pas encore prêt** tant qu’une exécution ne l’a pas déposé. Un fichier facultatif n’apparaît qu’une fois présent. Les motifs acceptent `*` et `?`, par exemple `return-*.xml`. Sans déclaration, le résultat regroupe tous les fichiers déposés par les exécutions, du plus récent au plus ancien. Une liste explicite aide à distinguer le rapport final des documents de travail.
