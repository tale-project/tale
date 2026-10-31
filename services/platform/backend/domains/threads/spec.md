# Threads — how the messages of a discussion keep their order

> **Prefix** `THREAD-`

A thread is the ordered list of messages under a task's or a project's discussion, or of a chat.
These rules say what happens when several messages arrive at once, and how a thread is read a
page at a time. Who can read or post is decided by the feature that owns the thread; see Not
yet.

## Posting at the same moment

### THREAD-R1 · Messages posted at the same moment each get their own place

Two posts never land on the same position and neither is lost: the one that arrives second
takes the next place. This holds for any number of posts at once.

- **Example**: Mia and an agent post to a task's discussion at the same instant → both
  messages appear, one after the other.

### THREAD-R2 · A post that finds no free place within 10 seconds fails and saves nothing

The post is refused with an error instead of waiting forever, and the thread is left as it
was.

- **Example**: Posts arrive on one thread so fast that Mia's finds no free place for 10 seconds
  → her post fails with an error, and no part of it is saved.

## Reading a thread

### THREAD-R3 · A thread is read a page at a time, newest page first

A page holds 200 messages unless the reader asks for another size. It lists its messages oldest
first and says where the page before it starts, until the thread's first message is in.

- **Example**: Mia opens a chat of 450 messages → she sees the newest 200; asking for earlier
  ones brings the 200 before them, then the first 50, and then there is nothing older to read.

### THREAD-R4 · Tool messages are left out unless the reader asks for them

- **Example**: An agent searched the web while answering in a task's discussion → the
  discussion shows the agent's answer and not the search; a chat, which asks for every message,
  shows both.

### THREAD-R5 · A read for an organization finds only that organization's messages

- **Example**: Mia's chat is read for her organization → the page holds her organization's
  messages and nothing another organization keeps under the same thread.

## Not yet

- **A page's ceiling**: a reader never gets more than 500 messages to a page, whatever size it
  asks for. No test holds this yet (`listThreadMessagesTail` in `store.ts`).
- **Editing and deleting a message** (`updateMessageText`, `deleteMessage`).
- **Who can read or post**: decided by the tasks, projects and chat domains, not here.
- **Chat's other reads**: the chat transcript reads its pages through this reader; one message
  and the messages of a settled turn are read by the chat domain's own readers
  (`message-views.ts`).
