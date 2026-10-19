# login-shell-path.sh — installed as /etc/profile.d/tale-path.sh in the runtime image.
#
# The image puts its tools on PATH with `ENV PATH` (Dockerfile), and
# entrypoint.sh puts the session's dependency directories in front of it
# before it starts runnerd. A login shell throws all of that away: Debian's
# /etc/profile sets PATH to its own default (/usr/local/bin:/usr/bin:/bin ...)
# and only then reads this directory. Without this file a login shell finds
# bun, uv and python3 (in /usr/local/bin) but not node, npm, npx (in
# /opt/node/bin), not the agent CLIs (codex, claude, gemini ... in
# /opt/agents/bin) and not a package a session installed (the pip and npm
# prefixes under /agent/.runtime/deps). Two things run login shells here:
# runnerd's `shell` exec form (`bash -lc`) and the shell tool of Codex
# (`/bin/bash -lc`).
#
# This puts back what `ENV PATH` and entrypoint.sh name, in the same order, in
# front of what /etc/profile built. Nothing is replaced, so root's login keeps
# the sbin directories Debian gives it. The session's dependency directories
# are writable by the agent: root never gets them, as root helpers in the
# entrypoint never run with them. A test holds the directories below to the
# Dockerfile and entrypoint.sh (daemon/src/login-shell-path.test.ts).
PATH="/opt/agents/bin:/opt/node/bin:$PATH"
if [ "$(id -u)" -ne 0 ]; then
  PATH="/agent/.runtime/deps/python/bin:/agent/.runtime/deps/node/bin:$PATH"
fi
export PATH
