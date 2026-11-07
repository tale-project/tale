# Settings

> **Prefix** `SET-` · **Reset** once, at the start · **Cost** ~60 min

What a person still has to judge in Settings: the whole app read in German and in French by someone who
speaks them, and AI access with real assistants connected to `/mcp` running tasks you watch. Everything
the specs hold (the start page and its draft, the theme, the language switch, the AI access switch, the
endpoint obeying it, the snippets and their copy buttons, the five groups of tools) is in
[`../reference/automation.md`](../reference/automation.md); a box here never restates it.

## Preconditions

Stack A or B after a reset ([`../setup.md`](../setup.md)); AI access starts off. For the assistant
boxes: stack B on a Mac (or A, where there is no window but every tool answers), one running session
with a proxy, one more free proxy for the session the assistant creates, a Credentials secret named
`Test login` for the running session, and an MCP client:
[Claude Code](https://docs.claude.com/en/docs/claude-code) is what the boxes name; Cursor and Claude
Desktop have their own boxes. **Switch AI access off again when a box says so**: an assistant left
connected is a second writer in every later round.

> **Agent note**: the switch is `role="switch"` named "Allow AI assistants to connect"
> (`settings.aiAccess.switch.label`). Check `/mcp` from a shell with
> `curl -s -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' {origin}/mcp`.
> A task you give an assistant is judged by what it does in the manager: its sessions in the list, the
> window of the session it works in, the log of the manager.

## The languages

- [ ] `SET-F9` · **Read every page, dialog, empty state and error you can reach in German, then in French,
  as a native reader** → the reader is addressed informally (du, tu), the words are the app's
  (Sitzung, Proxy, Secrets, KI-Zugriff; session, proxy, secrets, accès IA), counts read right for one
  and for several ("1 Sitzung wird angezeigt", "Alle 2 Sitzungen werden angezeigt"; "Affichage de 1 session au
  total", "Affichage de 2 sessions au total"), no button or label is cut off by a longer word, and no
  sentence is half English (the cause of a failed proxy check and the browser's own words in a failure are
  English by design).

## AI access

- [ ] `SET-F14` · **Switch AI access on, copy the Claude Code command from the page (Copy command,
  `settings.aiAccess.connect.copyCommand`), run it, start `claude` and open its MCP panel (`/mcp`)** →
  `session-manager` is connected and lists its tools, the 43 of the README's table; the page needed no
  restart.
- [ ] `SET-F15` · **Ask the assistant: "With session-manager, give me an overview, then create a session
  named assistant-test for macOS, open https://example.com, tell me the page's heading and stop the
  session."** → the overview matches the page (sessions, proxies and how many are free, secrets, the
  start page); `assistant-test` appears in the list and reaches **Running**; its window opens behind the
  app you are in, and once Show window brings it forward you watch it change when the assistant navigates,
  within a second or two; the heading it reports is what the window shows; the session ends **Stopped**.
- [ ] `SET-F16` · **While an assistant works in a session, type into its window yourself, then ask the
  assistant to read the page** → it reports what you typed, and its transcript shows the page's text
  between a BEGIN and an END UNTRUSTED PAGE CONTENT line that carry the same code; a click of yours between
  two of its calls does not break either; nothing crashes when both of you act at once.
- [ ] `SET-F17` · **Ask the assistant to open a test login page in the session `Test login` belongs to
  and log in with that secret using `type_secret`, without reading its values; then ask it to list the
  secrets** → it fills the form and
  logs in; its transcript names the fields it typed but shows no password or other masked value;
  `list_secrets` gives titles, kinds and previews and no hidden value; asking it to read the password
  (`get_secret`) works and the transcript then shows it, which is what the page's warning promises.
- [ ] `SET-F18` · **Ask the assistant to click a button that opens a JavaScript `alert`** → its tool
  returns at once and says a dialog waits; the dialog appears in the session's window, Camoufox's own;
  answering it there lets the assistant's next call go on, and so does `handle_dialog` from the
  assistant; one the assistant leaves for two minutes stays in the window for you, and the assistant is
  no longer told of it.
- [ ] `SET-F20` · **Switch AI access off in the middle of a task, wait for the assistant's next call, then
  switch it on again** → its next call fails because the endpoint answers `403` and the assistant tells
  you the server refused it; the sessions it started keep running; after you switch AI access on, the
  assistant reconnects (in Claude Code, from its MCP panel) without adding the server again.
- [ ] `SET-B2` · **Ask the assistant to start a session when every proxy is taken, and to delete a proxy
  a running session uses** → each answer is the app's sentence, such as "No free proxy available: every
  session needs its own proxy. Add proxies to continue." and "Session {name} is using proxy {proxy} right
  now. Stop the session first.", and the assistant reports it without trying the same call in a loop.
- [ ] `SET-F22` · **Connect Cursor with the `mcp.json` block (the tab "Cursor and other assistants", Copy
  configuration, `settings.aiAccess.connect.copyConfig`), and Claude Desktop with the `mcp-remote` block (the
  tab "Claude Desktop"; it needs Node.js and its first run downloads the helper), and ask each for the
  overview** → both connect and answer; both stop with `403` once AI access is off.
