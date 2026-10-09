# Projects — who can reach a project, and what its settings, agents and delete are held to

> **Prefix** `PROJ-` · **Suite** [`projects`](../../../tests/manual/suites/projects.md) · **Docs** [`projects/concepts`](../../../../../docs/en/platform/projects/concepts.md)

A project gathers tasks, files, agents and automations. It is open to the whole organization
or restricted to teams. These rules cover who can read and change a project, what a project
can be shared with, what an archived project refuses, the project's agents, and what deleting
a project does. Tasks have their own spec; files, the managed instructions written by a
deployment, and how the standard agent picks its model are not covered; see Not yet.

## Who can reach a project

| | A project open to the organization | A project restricted to teams |
| --- | --- | --- |
| An owner or admin | read and change | read and change, in any team or none |
| A developer or editor | read and change | read and change, when in one of its teams |
| A member | read | read, when in one of its teams |
| Anyone outside its teams | | nothing |

### PROJ-R1 · Owners and admins can read and change every project of their organization

Team membership does not matter for them.

- **Example**: A project is restricted to the Finance team. Ada, an admin who is in no team,
  opens it and changes its settings → both work.

### PROJ-R2 · A project restricted to teams is reached only by people in one of them

It makes no difference whether the team owns the project or the project was shared with it.
Someone in none of its teams can neither read nor change it. A disabled seat reaches nothing.

- **Example**: A project is restricted to Finance and shared with Legal. Noah, an editor in
  Legal, changes it → accepted. Mia, a member in neither team, opens it → refused.

### PROJ-R3 · Developers and editors can change a project they reach; members can only read

- **Example**: Mia is a member of the Finance team. She opens a Finance project → she can read
  it, and its settings are refused to her.

## Sharing and identity

### PROJ-R4 · A project can be restricted only to teams of its own organization

Creating a project for a team the organization does not have, or sharing one with such a team,
is refused (`PROJECT_SHARING_INVALID`), and nothing is saved. Naming a team twice counts once.

- **Example**: A request shares a project with the ID of a team from another organization →
  refused.

### PROJ-R5 · A project's key and its external ID are unique in the organization

The key is the short code in front of its task numbers. A key another project has is refused
(`PROJECT_KEY_TAKEN`), and so is an external ID another project carries
(`PROJECT_DUPLICATE_EXTERNAL_ID`). A project whose name yields no key is created without one.

- **Example**: A project with the key `OPS` exists. Noah creates another with the key `ops` →
  refused.

### PROJ-R6 · Project instructions are held to one length limit, wherever they are written

Text over the limit is refused (`PROJECT_INSTRUCTIONS_TOO_LONG`), with a message that names
the limit, and is never cut.

- **Example**: Noah pastes instructions one character over the limit → refused.

## Archived projects

### PROJ-R7 · Nothing about an archived project can be changed until it is restored

Changing its settings, its external ID, its agents or its secrets is refused
(`PROJECT_ARCHIVED`), for the people who could change it otherwise too. It stays readable.

- **Example**: The project Billing was archived. Ada, an admin, adds a secret to it → refused.
  She can still open the list of its secrets.

## Project agents

### PROJ-R8 · Two agents of a project cannot have the same name

Upper and lower case make no difference. Creating an agent under a name that is taken, or
renaming one to it, is refused (`PROJECT_AGENT_NAME_TAKEN`).

- **Example**: A project has an agent named Researcher. Noah adds one named `researcher` →
  refused.

### PROJ-R9 · An agent can be given only what its project and organization can use

A model the organization cannot call, a provider it has no credential for, and a skill or
other equipment the project cannot see are refused by name. So is a runtime that brings its
own credentials or that the platform does not know (`PROJECT_AGENT_HARNESS_INVALID`). Only
what a save adds is checked: equipment an agent already had, and the project can no longer
see, does not block other changes.

- **Example**: Noah equips an agent with a skill shared with a team the project is not on →
  refused, with the skill's name.

### PROJ-R10 · A save made from an outdated copy of an agent is refused

A save can say which version of the agent it started from. When the agent changed in between,
it is refused (`PROJECT_AGENT_STALE`) with the current version. A save that names what is
already stored writes nothing.

- **Example**: Noah and Ada open the same agent. Ada saves first. Noah saves from the dialog he
  opened earlier → refused.

### PROJ-R11 · The standard agent cannot be edited; it follows the organization's policy

The standard agent is the one a project gets so that any member can hand it work. Saving
changes to it is refused (`PROJECT_AGENT_MANAGED`). A project gets none while the organization
has switched the standard agent off, and an archived project gets none.

- **Example**: Noah changes the model of a project's standard agent → refused.

### PROJ-R12 · Deleting an agent clears it from the tasks it was assigned to

The tasks stay and lose their assignee, in the same step as the delete, and the audit log
records how many.

- **Example**: An agent is assigned to four tasks. Noah deletes the agent → the four tasks
  are unassigned.

### PROJ-R18 · An agent's mention handle is its name in plain letters, unique in its project

The handle is what a person types after `@` to find the agent: lowercase letters, digits and
single hyphens, with German umlauts and ß spelled out and other accents dropped, at most 48
characters before a suffix. When another agent of the project already holds it, or a person or
an automation of the organization answers to it, the agent gets the next free one: `-02`,
`-03` and on. A name with no letter or digit that can be spelled this way gives `agent`.

- **Example**: Mia adds an agent named "My Opus Agent #3" → it answers to `@my-opus-agent-3`.
  Noah then adds "My Opus Agent 3" → it answers to `@my-opus-agent-3-02`.

### PROJ-R19 · Renaming an agent gives it the handle of its new name

A rename that changes only upper and lower case or punctuation keeps the handle, and so does
every other save. The old handle is free for another agent. A mention names the agent itself,
so what was written about it shows its new name. An agent whose handle a person or an automation
of the organization comes to answer to later (a member joins, an automation is saved) moves on
the same way: it answers to the next free handle at once, the Agents tab and the API show that
one, and the project's next agent save stores it.

- **Example**: Mia renames the agent Research Bot to QA Bot → it answers to `@qa-bot`, and
  `@research-bot` is free for a new agent.
- **Example**: Ines's agent "Invoice checker" answers to `@invoice-checker`; Marco then saves
  an automation named `invoice-checker` → the agent answers to `@invoice-checker-02`.

## Secrets

### PROJ-R13 · Only owners and admins can change a project's secrets

Being able to change the project is not enough: a developer, an editor and a member are
refused (`PROJECT_FORBIDDEN`).

- **Example**: Mia, a member who can read the project, adds a secret to it → refused.

## Deleting a project

### PROJ-R14 · A project an automation is installed in cannot be deleted with its content

The delete is refused (`PROJECT_HAS_BOUND_AUTOMATIONS`) with the names of the automations,
before anything is removed. Remove the project from those automations first.

- **Example**: Two automations are installed in a project. Ada deletes the project and its
  content → refused, with both names.

### PROJ-R15 · A delete with content removes nothing when one record is protected

When any document of the project is kept as a record and has an approved version, the whole
delete is refused (`PROJECT_HAS_PROTECTED_RECORDS`) with the names of those documents, and
nothing is removed. A delete that keeps the content destroys nothing, so it is not held to
this.

- **Example**: A project holds an approved procedure, `SOP-7.pdf`. Ada deletes the project and
  its content → refused, with the document's name, and every document stays.

### PROJ-R16 · Deleting a project retires every task in it

Whether the content is deleted or kept, each task of the project is deleted the way a single
task is: its running agents are stopped and its reviews closed.

- **Example**: A project has a task whose agent is running. Ada deletes the project → the run
  is stopped and the task is gone.

## Managed tools

### PROJ-R17 · Managed tool configuration changes only an existing agent's tool grants

An editor who can edit the active project may reconcile a non-managed agent's
explicit tool set against its current configuration hash. Unknown tools and
stale hashes are refused. Equivalent sets are a no-op; a change advances the
agent revision and preserves its instructions, model, skills, connectors and
exact secret grants. Members may read the visible configuration but cannot
change it. Reads expose only the project and agent identity, tools and hash.

- **Example**: Ada adds independent review to an existing worker through its
  managed tools configuration → its other equipment and private secret grants
  remain unchanged; a concurrent stale full-agent save is refused.

## Managed models

### PROJ-R20 · Managed model changes preserve existing work and agent equipment

An editor of the active project may adopt an existing non-managed agent's
harness, model and explicit provider against their current hash. The same
model catalog and harness rules as the agent editor apply. Stale hashes and
unavailable serving choices are refused. An equal tuple changes no revision or
audit row. A change preserves all equipment and secret grants exactly and
invalidates stale full-agent saves. Queued and running work keeps its admitted
serving tuple; no run is restarted. Reads expose only identity, serving choices
and their hash, including an existing unpinned provider.

- **Example**: Ada changes a worker's provider and model while a task is queued
  → that task keeps its original provider and model; the next admission uses the
  new pair, and the worker's private secret grants remain unchanged.

## Not yet

- **Tasks**: see the tasks spec.
- **Project files and folders**: see the folders spec; documents have their own domain.
- **Duplicating a project**, its icon and colour, and the limits on its name.
- **Managed instructions**: text a deployment writes into projects, agents and tasks
  (`managed-instructions.ts`).
- **How the standard agent chooses its runtime and model** (`standard-agent.ts`).
- **The secrets an agent is granted**: names that are not stored are dropped from a save, or
  refused when the caller asks for that (`PROJECT_AGENT_SECRET_UNKNOWN`).
- **Projects over the REST API** (`rest/v1-projects.ts`).
