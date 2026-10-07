# Threads — how the messages of a discussion keep their order

> **Prefix** `THREAD-`

A thread is the ordered list of messages under a task's or a project's discussion. These rules
say what happens when several messages arrive at once. Who can read or post is decided by the
feature that owns the thread, and reading a thread is not covered; see Not yet.

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

## Not yet

- **Reading a thread**: a page holds 200 messages unless asked otherwise and never more than
  500, newest page first, and leaves out tool messages unless asked. No test holds these yet
  (`listThreadMessagesTail` in `store.ts`).
- **Editing and deleting a message** (`updateMessageText`, `deleteMessage`).
- **Who can read or post**: decided by the tasks, projects and chat domains, not here.
- **Chat threads** keep their own readers in the chat domain.
