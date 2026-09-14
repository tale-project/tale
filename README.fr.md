<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo-dark.svg">
  <img alt="Tale" src=".github/assets/logo-light.svg" width="150">
</picture>

[![Build](https://github.com/tale-project/tale/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/tale-project/tale/actions/workflows/build.yml)
[![Tests](https://github.com/tale-project/tale/actions/workflows/checks.yml/badge.svg?branch=main)](https://github.com/tale-project/tale/actions/workflows/checks.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[English](README.md) · [Deutsch](README.de.md) · [Français](README.fr.md)

</div>

# Tale

Tale réunit le chat IA, les projets, les connaissances et les automatisations dans un même espace de travail. Pose des questions sur tes documents, confie une tâche précise à un agent, puis examine son travail avec ton équipe. Tu choisis les fournisseurs de modèles et tu héberges Tale sur ton infrastructure ou utilises le service Cloud géré.

Le code est sous licence MIT. Community et Enterprise donnent accès aux mêmes fonctions ; Enterprise ajoute l’exploitation et l’assistance professionnelles. Consulte [les offres et les tarifs](https://tale.dev/pricing) pour connaître les conditions actuelles.

<table>
  <tr>
    <td width="50%" valign="top">
      <a href="services/docs/public/images/platform/chat-arena-split.webp"><img src=".github/assets/readme-gallery-chat-arena.webp" alt="Arena affiche deux réponses au même prompt et les commandes de vote." width="100%"></a>
      <br><a href="https://tale.dev/docs/fr/platform/chat/arena-mode"><b>Chat et Arena</b></a><br><sub>Compare deux réponses côte à côte.</sub>
    </td>
    <td width="50%" valign="top">
      <a href="services/docs/public/images/platform/projects-task-board.webp"><img src=".github/assets/readme-gallery-tasks.webp" alt="Le tableau des tâches du projet Website relaunch regroupe les cartes par statut." width="100%"></a>
      <br><a href="https://tale.dev/docs/fr/platform/projects/tasks"><b>Tâches de projet</b></a><br><sub>Organise le travail et suis son avancement.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <a href="services/docs/public/images/platform/project-agents-models.webp"><img src=".github/assets/readme-gallery-project-agents.webp" alt="L’onglet Agents du projet présente les agents avec leur moteur et leur modèle." width="100%"></a>
      <br><a href="https://tale.dev/docs/fr/platform/projects/project-agents"><b>Agents de projet</b></a><br><sub>Choisis les instructions, le moteur, le modèle et les outils.</sub>
    </td>
    <td width="50%" valign="top">
      <a href="services/docs/public/images/platform/automation-editor-canvas.webp"><img src=".github/assets/readme-gallery-workflow-editor.webp" alt="L’éditeur d’automatisation montre les étapes reliées et les réglages du nœud sélectionné." width="100%"></a>
      <br><a href="https://tale.dev/docs/fr/platform/automations/editor"><b>Éditeur de workflow</b></a><br><sub>Examine les étapes, les données de test et les exécutions.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <a href="services/docs/public/images/platform/connectors-add-credential.webp"><img src=".github/assets/readme-gallery-connectors.webp" alt="Le dialogue d’ajout d’identifiants présente les connecteurs disponibles." width="100%"></a>
      <br><a href="https://tale.dev/docs/fr/platform/connectors/overview"><b>Connecteurs</b></a><br><sub>Choisis les services utilisés par ton espace.</sub>
    </td>
    <td width="50%" valign="top">
      <a href="services/docs/public/images/platform/governance-guardrails.webp"><img src=".github/assets/readme-gallery-guardrails.webp" alt="Les réglages des garde-fous affichent l’état des règles et les paramètres disponibles." width="100%"></a>
      <br><a href="https://tale.dev/docs/fr/platform/admin/governance/guardrails"><b>Gouvernance</b></a><br><sub>Vérifie les règles de sécurité et de traitement des données.</sub>
    </td>
  </tr>
</table>

Ouvre une capture pour la voir en taille réelle. Les images montrent l’interface en anglais.

## Choisir ton point de départ

| Ton objectif | Guide à suivre |
| --- | --- |
| Utiliser un espace de travail existant | [Envoyer ton premier message](https://tale.dev/docs/fr/get-started/quickstart) |
| Installer Tale | [Démarrage en auto-hébergement](https://tale.dev/docs/fr/self-hosted/install/quickstart) |
| Obtenir une instance gérée | [Demander une démo](https://tale.dev/request-demo) |
| Créer un agent pour un projet | [Créer et tester un agent de projet](https://tale.dev/docs/fr/get-started/editors) |
| Connecter une autre application | [Premiers pas avec l’API](https://tale.dev/docs/fr/get-started/developers) |
| Modifier le code source | [Préparer l’environnement de développement](docs/fr/develop/contributor-setup.md) |

### Lancer une instance locale

Installe la CLI Tale, crée un projet, puis démarre son environnement de développement :

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
tale init my-project
cd my-project
tale dev
```

Cet environnement nécessite Docker. Suis les indications de la CLI et attends que Docker soit prêt avant de lancer Tale. Au premier démarrage, la CLI télécharge les images des conteneurs, puis affiche l’adresse à ouvrir. Crée le premier compte et l’organisation dans l’assistant de configuration. Connecte ensuite un fournisseur IA pour obtenir des réponses des modèles.

Le [guide d’installation](https://tale.dev/docs/fr/self-hosted/install/quickstart) couvre Windows, les prérequis et les problèmes de démarrage. La [référence CLI](tools/cli/README.md) décrit les commandes et les options. Avant de passer sur un serveur, consulte le [guide de déploiement](https://tale.dev/docs/fr/self-hosted/install/cli-install).

### Développer depuis le code source

Utilise la version de Bun indiquée dans [package.json](package.json), une version compatible de Node.js et Docker pour les services associés. Python et uv sont aussi nécessaires pour toutes les vérifications du dépôt. Le [guide de préparation](docs/fr/develop/contributor-setup.md) détaille les versions, les variables d’environnement et les ports.

```bash
bun install --frozen-lockfile
bun run setup:check
bun run dev
```

Attends le message indiquant que la plateforme est prête, puis ouvre l’adresse affichée. Le contrôle de configuration ne vérifie qu’une partie de l’environnement. Sa réussite ne garantit pas que les bases de données, le stockage et le fournisseur de modèles sont configurés.

Pour travailler uniquement sur la documentation, tu n’as besoin ni de la base de données de la plateforme ni d’un fournisseur :

```bash
bun run --filter @tale/docs dev
```

## Ce que tu peux faire

- **[Chat](https://tale.dev/docs/fr/platform/chat/basics) :** rédiger, comprendre un sujet et travailler sur des informations dans une conversation. Compare les modèles dans Arena et vérifie les sources des réponses qui utilisent les connaissances.
- **[Projets](https://tale.dev/docs/fr/platform/projects/overview) :** rassembler tâches, fichiers, instructions et chats liés à un travail. Choisis les chats à partager avec le projet.
- **[Agents de projet](https://tale.dev/docs/fr/platform/projects/project-agents) :** définir les instructions, l’environnement d’exécution, le modèle et les outils. Attribue une tâche, lance l’agent, puis examine son résultat.
- **[Connaissances](https://tale.dev/docs/fr/platform/knowledge/overview) :** préparer documents, entrées de connaissances et sites web pour la recherche. Le chargement et l’indexation sont deux étapes distinctes.
- **[Automatisations](https://tale.dev/docs/fr/platform/automations/concepts) :** assembler les étapes d’un workflow, le tester, puis le lancer manuellement ou avec des déclencheurs configurés.
- **[Connecteurs](https://tale.dev/docs/fr/platform/connectors/overview) :** connecter des services externes et des outils MCP avec les identifiants de ton espace de travail.
- **[Administration](https://tale.dev/docs/fr/platform/admin/overview) :** gérer membres, rôles, fournisseurs, règles, utilisation et journaux d’audit.

Les fonctions disponibles dépendent de ton rôle et de la configuration. Un modèle local garde l’inférence sur ton infrastructure ; les services connectés et les outils externes conservent leurs propres flux de données. Consulte la [résidence des données](https://tale.dev/docs/fr/self-hosted/configuration/data-residency) avant de choisir ton déploiement.

## Documentation

La documentation existe en [anglais](https://tale.dev/docs), en [allemand](https://tale.dev/docs/de) et en [français](https://tale.dev/docs/fr).

Commence par une tâche guidée. Les pages Plateforme accompagnent le travail quotidien ; les références d’exploitation et d’API donnent les détails de configuration. La [galerie de captures](SCREENSHOTS.md) présente les principales vues. Pour améliorer les guides, lis le [README de l’espace Docs](services/docs/README.md).

## Contribuer ou obtenir de l’aide

Lis [CONTRIBUTING.md](.github/CONTRIBUTING.md) et les [règles du dépôt](AGENTS.md) avant de modifier le code. Exécute `bun run check` avant de proposer une Pull Request. Le guide de contribution indique les autres vérifications adaptées à ta modification.

- Pose tes questions dans [GitHub Discussions](https://github.com/tale-project/tale/discussions).
- Signale les bugs reproductibles dans [GitHub Issues](https://github.com/tale-project/tale/issues), avec la version, les étapes, le résultat attendu et le résultat obtenu.
- Signale les vulnérabilités avec le [canal de sécurité privé](https://github.com/tale-project/tale/security).

## Licence

Tale est disponible sous [licence MIT](LICENSE).
