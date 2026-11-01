# Chat — who can see a chat, what a message is refused for, and what a delete takes

> **Prefix** `CHAT-` · **Suite** [`chat`](../../../tests/manual/suites/chat.md) · **Docs** [`chat/basics`](../../../../../docs/en/platform/chat/basics.md)

The rules a chat is held to: who can open, continue, share and delete it, what a project share
and a share link give and take, what a message is refused for, that a chat answers one message
at a time, what stopping, editing and trying again guarantee, what Arena Mode promises, what a
delete takes with it, what the REST API can and cannot do, and what the assistant may make and
where it lands. Attachments, messages that wait for their attachments, the assistant's search,
usage booking, title generation and harness-backed chats are not covered; see Not yet.

## Who can see a chat

A chat belongs to the person who started it. What anyone else can do with it depends on one
thing: whether its owner shared it with a project.

| | Open and read it | Continue, rename, share, archive or delete it |
| --- | --- | --- |
| The person who started it | yes | yes |
| Someone who can read the project it is shared with | yes | no |
| Any other member of the organization | no | no |
| A member of another organization | no | no |

### CHAT-R1 · A chat is visible only to the person who started it, in their organization

Another member, a member of another organization, and anyone naming a chat that is already in
the trash are answered as if the chat did not exist (404): for the chat itself, its messages,
its reply status and a new message alike. Renaming, sharing, archiving and deleting are the
owner's as well. The one exception is a chat shared with a project (`CHAT-R2`).

- **Example**: Noah, a member of the same organization, opens Mia's chat by its id → not found,
  and the same for its messages.
- **Example**: Zoe, in another organization, sends a message to Mia's chat over the API → not
  found, and nothing is queued.

### CHAT-R2 · Sharing a chat with a project lets everyone who can read the project read it

Only the owner can share it. A reader sees the conversation as the owner sees it: after an
edit or a retry, the version on the owner's screen (`CHAT-R10`), never the other versions and
never their ids. They can read it, not continue or change it (`CHAT-R1`). Being in the project
shares nothing by itself: a chat nobody shared, and a chat in a project the reader cannot open,
stay absent (404).

- **Example**: Mia files a chat in a project Noah can read and shares it with the project →
  Noah can open and read it. Mia chooses **Try again** on a reply → Noah now reads the new
  reply in its place.

### CHAT-R3 · Moving a chat to another project ends its project share

The share named one audience. Moving the chat to another project, or taking it out of projects
altogether, switches the share off and records that on the project it leaves; the owner shares
it again in the new project if they want to. Filing it under the project it is already in
changes nothing.

- **Example**: Mia shared a chat with project A. She moves it to project B → A's members lose
  it, and B's members do not see it until Mia shares it again.

### CHAT-R4 · A share link shows the conversation as it was when the link was made

The link publishes the version on the owner's screen (`CHAT-R10`) up to the moment of
sharing; messages written afterwards stay out until the owner shares again with **Include
newer messages**. A version that is not the owner's own live version of that chat cannot be
published. The link goes dark as soon as the chat is in the trash or the owner stops sharing;
a chat already in the trash can still be unshared, and nobody else can unshare it.

- **Example**: Mia shares a chat, then asks two more questions → a colleague opening the link
  reads the chat up to the point Mia shared it, and nothing later.

## Sending a message

### CHAT-R5 · A chat answers one message at a time

While a reply is being written, or while a message sent over the API is still waiting for its
turn, a further message is refused (`CHAT_TURN_IN_PROGRESS`) and nothing is saved. When two
sends race for the same chat, one runs and the other is refused without touching the first:
the running reply is neither cut nor closed by the loser.

- **Example**: Mia sends a message while the assistant is still answering her last one → the
  new message is refused, and the running reply continues.

### CHAT-R6 · A message over a spending limit is refused before anything is saved

The limits themselves are governance's (`GOV-R1` to `GOV-R6`). Before a message is saved,
queued or branched, the sender's limits are measured; a reached one refuses the message,
naming the limit and when it resets (`BUDGET_EXCEEDED`; over the API 429, the wait in
`Retry-After`). **Edit message** and **Try again** are measured the same way before the
version is made, and an arena prompt is measured for both columns together: a limit that
stops it stops both sides.

- **Example**: Mia's team has used up its daily cost limit. She chooses **Try again** on a
  reply → refused, naming the team's daily limit and its reset time; no new version appears.

### CHAT-R7 · A message naming a model that is not available to the sender is refused

Not available means: not in the list the sender may pick from (their model access, `GOV-R8`,
and what a provider serves), or no longer served. The refusal comes before anything is saved
or queued and says why. Over the API it is `CHAT_MODEL_UNKNOWN` (400); a provider the list
does not carry is `CHAT_PROVIDER_UNKNOWN`, a listed provider that does not serve the model
`CHAT_MODEL_NOT_ON_PROVIDER`, and a model two providers serve `CHAT_MODEL_AMBIGUOUS` until
one is named.

- **Example**: Mia's composer still shows a model an admin retired yesterday. She sends → the
  message is refused with the reason, and the chat is unchanged.

### CHAT-R8 · A message the organization's filters block never reaches a model

The organization's chat filter and moderation judge the message first. A blocked message calls
no model and costs nothing. The chat keeps the message and, in place of a reply, a note that it
was blocked and by which policy, so the refusal can be explained. Trying again on a blocked
message adds only the note.

- **Example**: Mia's message contains a word the organization's filter bans → no reply is
  generated; the chat shows her message and a blocked reply naming the filter.

## Stopping, editing and trying again

### CHAT-R9 · Stopping a reply keeps what was already written, marked as stopped

The text streamed so far stays, the reply is recorded as stopped rather than complete, and
the usage it cost is recorded with it. Over the API, a stop on an idle chat answers
`CHAT_TURN_NOT_RUNNING` (404) with the last reply, and a send still waiting for its turn can
be stopped too: it is settled as stopped without a model call, and the message stays on the
chat.

- **Example**: Mia clicks **Stop generating** after two sentences → the two sentences stay,
  and the reply is marked as stopped.

### CHAT-R10 · Editing a message or trying again adds a version beside the original

**Edit message** and **Try again** never rewrite the conversation. Each makes a new version
that carries the conversation up to that turn; every version of one turn, the original among
them, sits side by side under the chat's one id. What a project reader (`CHAT-R2`) or a share
link (`CHAT-R4`) sees is the version on the owner's screen.

- **Example**: Mia chooses **Try again** on a reply, then edits the question above it → that
  turn has three versions, and the original is still reachable.

## Arena Mode

A comparison runs one prompt in two columns, each a model of the person's choice, and ends
with a verdict or an exit.

### CHAT-R11 · An arena verdict is recorded only when both columns hold a finished reply

A verdict compares this round's two replies. When a column holds a failed reply, an
unanswered prompt, or no reply of this round at all, the verdict is refused and nothing is
written. **Exit without verdict** works in every case and records no rating. What a verdict
counts as is feedback's (`FDBK-R6`, `FDBK-R7`).

- **Example**: Model B's column shows a provider error. Mia picks A as the better reply →
  refused; she can only exit without a verdict.

### CHAT-R12 · Ending an arena keeps one column and moves the other to the trash

The chosen column continues as the chat; the other is discarded like a deleted chat, moved to
the organization's trash as a chat of its own, with an audit entry, on a plain exit too. Under a
legal hold it is kept hidden and archived instead. The second column starts with the same
project filing and reasoning effort as the conversation, so the chat stays where it was
whichever side wins.

- **Example**: Mia picks B as the better reply → the chat continues with column B, and column
  A is in the trash.

## Deleting a chat

### CHAT-R13 · Deleting a chat takes its versions and its waiting messages with it

Deleting moves the chat to the trash; its other versions (`CHAT-R10`) go with it, messages
still waiting for their attachments are cancelled and never send, and its share link goes
dark (`CHAT-R4`). A chat that is answering, or whose API send is still waiting, cannot be
deleted (`CHAT_TURN_IN_PROGRESS`); a chat under a legal hold can be neither deleted nor
archived. What the trash keeps, and who restores from it, is not covered here; see Not yet.

- **Example**: Mia deletes a chat while a message waits for a recording to be transcribed →
  the chat is in the trash, and the waiting message never sends.

## The REST API

A chat over `/api/v1` is the same chat as in the app, held to the same rules above, with four
rules of its own.

### CHAT-R14 · The API creates chats with the built-in assistant only

A chat is created in the organization, or in a project the key holder can read, where any
member can create one. A body naming an agent, or a project outside the path, is refused (400)
and nothing is created. A chat that runs an agent in a sandbox can be read but takes no message
(`CHAT_THREAD_NOT_DIRECT`, 409).

- **Example**: Noah's integration creates a chat naming an agent → refused. It creates one
  without any selector → created, with the built-in assistant.

### CHAT-R15 · Repeating an API send with the same Idempotency-Key runs it once

The same key with the same body answers the remembered acceptance again, marked as a
duplicate, and queues no second reply. The same key with a different body is refused
(`IDEMPOTENCY_KEY_REUSED`, 409). A refusal is never remembered: a send refused because the
chat was busy can be repeated with the same key. A blank key, or one outside printable ASCII,
is refused (`INVALID_HEADER`, 400). A key counts within its project and chat only.

- **Example**: Noah's integration times out after sending and repeats the request with the
  same key → it receives the same reply id, marked as a duplicate, and one reply is written.

### CHAT-R16 · Over the API an archived chat or project can be read but not changed

In an archived project, chats can be listed and read; creating one, sending, archiving,
deleting and stopping are refused (403). An archived chat anywhere can be read but takes no
message (`CHAT_THREAD_ARCHIVED`, 409), also when it was archived in the moment its send was
being accepted.

- **Example**: The project Noah's integration writes to was archived. It reads the chat →
  served; it posts a message → refused.

### CHAT-R17 · An accepted API send is kept through a backend restart

A send answered with 202 is a promise. When the backend is restarting for an upgrade at the
moment its turn would run, the send is handed on and runs after the restart under the same
reply id, the poll answering queued meanwhile.

- **Example**: Noah's integration sends at the moment of a deploy → it polls queued a little
  longer, then reads its reply under the id the 202 named.

## What the assistant makes

Besides answering, the assistant can write a file, generate an image, read a skill and run code
in a light sandbox. Which of these it is offered, the organization decides; which one it uses,
the model decides, except a skill the person chose, which the reply reads first.

| Tool | Offered when |
| --- | --- |
| Writing a file | **Chat tools** › **Files** is on (the default) |
| Reading a skill | **Chat tools** › **Skills** is on (the default) |
| Running code in a light sandbox | **Chat tools** › **Code** is on (the default) |
| Generating an image | **Image generation** is on and an image model is available |

### CHAT-R18 · The assistant is offered only the tools the organization allows

A tool switched off under Chat tools, or images while image generation is off, is not offered on
any chat turn: the model is never told about it, except that pictures cannot be made
(`CHAT-R32`). A missing policy file offers every chat tool; images stay off until an admin turns
them on.

- **Example**: Ada, an admin, turns off **Code** under Chat tools. Mia asks her chat for an
  Excel file → her turn is offered no code tool.

### CHAT-R19 · A file the assistant makes belongs to the conversation it was made in

The file is kept in the organization's storage and bound to the conversation, so whoever can
read the conversation can open it. Code takes in only files of the same conversation; naming a
file of another conversation is refused before any sandbox starts (not found).

- **Example**: Mia's chat makes `report.docx` → the file is bound to that conversation. In
  another chat, Mia names that file for code to read → not found, and no sandbox starts.

### CHAT-R20 · A revised file replaces its earlier version in the same reply

When a later step of the same reply makes a document under the same name, the reply shows the
new version in the earlier one's place. Images are each a result of their own and always add.

- **Example**: The assistant writes `report.docx` for Mia, checks it and writes it again in the
  same reply → her reply shows one `report.docx`, the second version.

### CHAT-R21 · The assistant reads only the skills the person chatting can see

A skill beyond the person's reach, such as one shared with a team they are not in, is answered
as if it did not exist, so its existence never leaks.

- **Example**: Mia is not in the Finance team. Her chat asks for the Finance team's
  `budget-review` skill → not found.

### CHAT-R22 · A chat's images count against the person chatting, within their budget

An image is booked to the person chatting and to the chat's project, if it has one. A budget
limit that applies to them refuses the image before the image model is called, and holds
nothing. While an admitted image is being made it holds its estimate on the reply it belongs
to, and gives the hold back there: an image that finishes after its reply has ended lowers
nothing on the next reply, and is still booked.

- **Example**: Mia's monthly cap is spent. Her chat asks for an image → refused with the cap's
  reason; the image model is not called.
- **Example**: Mia stops a reply while an image is being made and sends a new message at once.
  The image finishes after the new reply began → it is booked to Mia, and the new reply's hold
  is unchanged.

### CHAT-R23 · One reply creates at most 16 images

Images asked for in the same step count together, however many calls make them.

- **Example**: Mia's reply has already created 15 images and asks for 2 more → refused.
- **Example**: The assistant asks for four images in each of ten calls at once → four calls
  run and the other six are refused; the reply never holds more than 16.

### CHAT-R24 · Each version of a file the code writes is attached once

A file the code writes to its output folder is attached when it is new or changed since the
sandbox's last run. A file the code leaves alone is never attached again, and every file stays
in the sandbox for the next run. A file rewritten with the same content is attached again only
when the conversation no longer shows the reply that got it: a reply tried again, or one after
an edited message, gets the file its own code wrote.

- **Example**: Mia's chat writes `report.csv`, then runs code that only reads it → nothing new is
  attached. A third run changes a row → the new version is attached.
- **Example**: Mia tries again a reply that attached `chart.png`, and the new reply's code draws
  the same chart → `chart.png` is attached to the new reply.

### CHAT-R25 · A step's tools are bounded, and Stop reaches them

However many tools the assistant asks for in one step, at most 16 run and the rest answer that
they did not. A step's tools run for at most five minutes. While they run, the reply stays
alive and Stop is heard: Stop, or the end of the five minutes, tells every running tool to
stop, and code is cut off in its sandbox — asked again a few times if the sandbox does not
know the program yet. Files a stopped program had already written stay in its output folder
and are attached by the next run.

- **Example**: Mia's assistant asks for 20 files in one step → 16 are made and the other four
  answer that they did not run; it can ask again in the next step.
- **Example**: The assistant runs code that waits ten minutes and Mia presses **Stop** after
  half a minute → the program is cut off within seconds, the reply is marked stopped, and her
  composer is free again.

### CHAT-R26 · A Chat tools policy that cannot be read offers no tool

An absent file offers every chat tool, as ever. A file that exists but cannot be read turns
files, skills and code off until it is repaired, rather than back on.

- **Example**: Ada turned **Code** off, then edited the policy file by hand and broke it →
  Mia's chat is offered no code tool, and Governance names the problem.

### CHAT-R27 · What a code run reports back is bounded however many files it wrote

At most ten new or changed files attach, as ever. A run looks at the 200 files of the output
folder written most recently; of the others, a short list is named and the rest are counted,
and the sandbox keeps them all. A file already delivered stays recorded as delivered while it
is out of view.

- **Example**: Mia's code writes 3,000 files to its output folder → the reply attaches ten,
  names twenty of the others and says how many more there are.

### CHAT-R28 · A reply whose file tools could not be set up says so

When the Chat tools policy cannot be read, or setting the tools up for a reply fails, the reply
runs without them and says under it that files could not be made in this reply. The assistant
is told the same, not that chat makes no files. A tool an admin switched off is no such failure:
that reply says nothing about it.

- **Example**: Ada broke the Chat tools policy file by hand. Mia asks her chat for an Excel file
  → the reply has no file, and under it reads that files could not be made because the policy
  cannot be read.

### CHAT-R29 · A skill the person chooses is read before the reply

A message that starts with `/` and a skill's name chooses that skill; so does checking it under
**Skills** in the composer, for every reply of the conversation. Each reply reads every chosen
skill again before the model answers, as a step of its own that costs the model none of its steps,
and what it reads counts against the reply's window: older turns give way to it. Only skills the
person can see count, at most four a reply; any other name stays text. A conversation's skills are
kept with it, every version of it reads them, and only its owner changes them. A conversation is
named from what its first message says after the skills it chose; a name that chose nothing stays
in the title.

- **Example**: Mia sends "/docx Write the cover letter" → the reply's first step reads the docx
  skill, then the model answers.
- **Example**: Mia checks `docx` and `xlsx` under **Skills** in a chat → every later reply in it
  reads both before it answers.
- **Example**: Mia is not in the Finance team and sends "/finance-review Check this" → nothing is
  read, and the message is sent as written.

### CHAT-R30 · A failed step says why it failed

A step that could not do its work says so under it, in the person's language: every light
sandbox is in use, the sandbox host is busy or not ready, the sandbox service cannot be reached,
the sandbox stopped working, a file the program needs could not be copied into the sandbox, the
program ended with an error or ran out of time, or it was stopped. The model reads the same
cause, and whether trying again can help.

- **Example**: All of the organization's light sandboxes are running code when Mia's chat runs
  code → the step reads that all light sandboxes are in use, and the reply tells her to try again
  in a minute.
- **Example**: Mia's chat runs code with a skill whose template is larger than the sandbox takes
  → the step reads that a file couldn't be copied into the sandbox, and the model is told which
  file it was, the limit it broke and that trying again will not help.

### CHAT-R31 · The assistant can start from a picture the person attached

A picture attached to a message reaches the model with its name and the reference a tool takes
it by, not only as pixels, so the image tool can start from it and code can read it. A picture
the person chatting can no longer read is named to no model.

- **Example**: Mia attaches `beach.jpg` and asks for a watercolor of it → the model hands
  `beach.jpg` to the image tool, and the image model starts from her photo.
- **Example**: A photo in Mia's earlier message was deleted since → her next reply's model is
  told of no such photo.

### CHAT-R32 · Without image generation, the assistant is told pictures cannot be made

While image generation is off, or no image model can serve it, a chat turn that offers other
tools tells the assistant that no photo, illustration or artwork can be made in the organization,
that an Admin or Owner turns image generation on under Settings › Governance › Models, and that
an SVG or a drawing made with code is no stand-in for such a picture. SVG stays for diagrams,
icons and charts. With image generation on, the assistant has the image tool and is told none of
this.

- **Example**: Image generation is off in Mia's organization. She asks her chat for a
  photorealistic image of a lighthouse → her assistant has no image tool, and is told to say
  that pictures cannot be made and that an Admin or Owner can turn image generation on, not to
  hand her an SVG as the photo.

### CHAT-R33 · Every file a reply made shows under it, as a picture or a card

A PNG, JPEG, GIF or WebP the reply made shows as a picture that opens the gallery. Every other
file, an SVG too, shows as a card with its name, type and size that opens the preview, with a
Download beside it; so does a picture that cannot be shown. The files show while the reply
streams, after a reload and on a reply tried again.

- **Example**: Mia's assistant writes `superheld-dunkle-gasse.svg` and says it is attached → a
  card for it shows under the reply, also after she reloads the chat; she opens its preview or
  downloads it.

### CHAT-R35 · A reply that speaks of a file it does not carry says no file was attached

A reply that carries no file, but set out to write one or to generate an image, or that ran
code and says in its own voice that it attached a file (in English, German or French), reads
under it that no file was attached to this reply. Its words alone mark nothing: a letter it
drafts, a sentence it translates and words about the person's own upload say "attached" too.
A code run alone is no attempt either: a calculation stores nothing by design. A reply that
carries a file, or speaks of none, says nothing; neither does a reply that already says its
files could not be made (CHAT-R28), nor one the guardrails blocked, which shows why instead.

- **Example**: Mia asks her chat for an SVG; writing the file fails, and the reply still says
  the file is attached → under the reply reads "No file was attached to this reply."
- **Example**: Mia asks her chat to draft an e-mail that says the Q3 report is attached → the
  draft reads "Please find attached the Q3 report", and no line shows under the reply.

## Not yet

- **Attachments on a message**: the gate that holds a message to at most 10 files of the
  supported kinds, each one readable by the sender in this organization
  (`validateTurnAttachments` in `../../core/chat/turn_action.ts`); no test holds it. The
  upload side is files' (`FILE-R5`). What the model receives of an image beyond its name and
  reference (`CHAT-R31`), of a document or of a recording (`../../../lib/chat/wire-parts.ts`,
  `../../../lib/chat/audio-transcript.ts`).
- **Messages that wait for their attachments** (`deferred-sends.ts`,
  `deferred-sends.watchdog.ts`): what makes a message wait, when it sends, and its bounds of 10
  waiting messages per chat and 20 attachments per message (`QUEUE_FULL`,
  `TOO_MANY_ATTACHMENTS`); no test holds the bounds. Over the API, a queued send is invisible
  on the message list and has no queue position; the contract debt ledger in
  [`.agents/repo.md`](../../../../../.agents/repo.md) records both.
- **Sending during a restart in the app**: a new message is refused with 503 and asked again
  in a moment (`routes.ts`); no test holds it.
- **Sharing with a project needs a chat filed in a project** (`THREAD_NOT_IN_PROJECT`), and
  **a share link opens only for a signed-in member of the chat's organization**
  (`getSharedThread` in `threads.ts`); no test holds either.
- **Owners and admins**: whether they can open a member's chat. Every read in `threads.ts` is
  scoped to the caller, and no test says so either way.
- **Undecided: can an archived chat be continued in the app?** The REST API refuses it
  (`CHAT-R16`); the app's send (`routes.ts`) checks nothing, and the app's own archive is
  deliberately not fenced against a running turn (`setThreadArchived` in `threads.ts`).
- **Undecided: is a chat title over 120 characters cut or refused?** The API refuses it
  (`INVALID_BODY`, `../../rest/v1-threads.ts`); the app's rename accepts up to 500 and cuts it
  to 120 silently (`renameThread` in `threads.ts`).
- **The trash**: the owner's own restore within the grace window (`restoreThread`), what an
  admin sees and restores, and the purge; the retention domain owns the sweep.
- **Arena Mode** beyond `CHAT-R11` and `CHAT-R12`: which chats cannot enter it (shared,
  archived, sandbox, busy), the history copied into the second column and its bound, and a
  double settle (`arena.ts`).
- **Which tool the assistant picks** for a request is the model's judgment, steered by the
  tools' descriptions and the work ladder (`../../../lib/agent/work-tools.ts`,
  `../../../lib/agent/ladder.ts`); no unit test can hold a model's choice. The light sandbox's
  bounds (three minutes a run, 10 files of 20 MB each, inputs and skills per call) are held
  only in part (`../agent_tools/run-code.ts`).
- **Undecided: what does a chat with every tool off say of a picture?** With every Chat tools
  switch and image generation off, the assistant gets no word of image generation
  (`CHAT-R32`); its instructions call an image task work for a project agent
  (`../../../lib/chat/assistant.ts`), though no agent of the organization can make one either.
- **What the assistant can search and fetch from a chat** (`../../core/chat/assistant_tools.ts`):
  the project boundary of a filed chat, the hub for a personal chat, and untrusted content;
  what a search finds is knowledge's (`KNOW-R3` to `KNOW-R5`), the inbox leg conversations'
  (`CONV-R2`).
- **The turn itself** (`../../../lib/chat/turn.ts`, `../../core/chat/turn_action.ts`): the
  tool loop, the reply cap, the stall guard, what a failed reply books, the reply language
  and custom instructions (`PREF-R1` to `PREF-R3`). A cut tool call's arguments are not on the
  transcript; the ledger in [`.agents/repo.md`](../../../../../.agents/repo.md) records it.
- **No image input on the REST send**: the ledger in
  [`.agents/repo.md`](../../../../../.agents/repo.md) records it.
- **Usage and cost booking** (`store.ts`, `budget-admission.ts` beyond `CHAT-R6`), **title
  generation** (`../../core/chat/generate_title.ts`), **the organization's filter policies**
  themselves (`../../core/chat/guardrails.ts`, `../../../lib/chat/guardrails.ts`), **the
  composer's model list and project capabilities** (`composer.ts`, `capabilities.ts`),
  **health**, **the watchdogs**, and **the chat's reads of tasks, contacts and products**
  (`shim.ts`).
- **Harness-backed chats** (`kind: sandbox`, `../../core/chat/external_turn_shared.ts`): their
  turns, steering, replay and how a turn's end is judged.
- **Chat search from the command palette** (`searchChats` in `threads.ts`) and the order of
  messages in a chat (threads', `THREAD-R1`, `THREAD-R2`).
- **Chat memories are retired**: the ledger in [`.agents/repo.md`](../../../../../.agents/repo.md)
  records it.
