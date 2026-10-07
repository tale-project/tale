import { capture } from './exec';

const SSH_CHECK = String.raw`
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import tempfile
import threading
from pathlib import Path

signal.alarm(30)
for command in ["git", "ssh", "ssh-agent", "ssh-add", "ssh-keygen", "nc"]:
    assert shutil.which(command), f"missing {command}"
environment = os.environ.copy()
agent = subprocess.run(["ssh-agent", "-s"], capture_output=True, check=True, text=True, timeout=10)
for name in ["SSH_AUTH_SOCK", "SSH_AGENT_PID"]:
    match = re.search(rf"{name}=([^;]+);", agent.stdout)
    assert match, f"agent omitted {name}"
    environment[name] = match.group(1)
try:
    with tempfile.TemporaryDirectory() as directory:
        key = Path(directory) / "synthetic"
        subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(key)], check=True, timeout=10)
        private = key.read_bytes()
        public = Path(str(key) + ".pub").read_text().split()[:2]
        key.unlink()
        subprocess.run(["ssh-add", "-"], input=private, env=environment, capture_output=True, check=True, timeout=10)
        loaded = subprocess.run(["ssh-add", "-L"], env=environment, capture_output=True, check=True, text=True, timeout=10)
        assert loaded.stdout.split()[:2] == public
finally:
    subprocess.run(["ssh-agent", "-k"], env=environment, capture_output=True, check=True, timeout=10)

# The public host need not resolve inside the sandbox: nc passes it to the
# existing HTTP proxy. A loopback stub proves CONNECT and its streamed reply.
request = []
with socket.socket() as listener:
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    listener.settimeout(10)
    port = listener.getsockname()[1]
    def proxy():
        connection, _ = listener.accept()
        with connection:
            connection.settimeout(10)
            received = b""
            while b"\r\n\r\n" not in received:
                received += connection.recv(1024)
            request.append(received.decode().splitlines()[0])
            connection.sendall(b"HTTP/1.0 200 Connection established\r\n\r\nSSH-2.0-Synthetic\r\n")
    thread = threading.Thread(target=proxy, daemon=True)
    thread.start()
    tunneled = subprocess.run(["nc", "-X", "connect", "-x", f"127.0.0.1:{port}", "repo.example", "443"], input=b"", capture_output=True, timeout=10)
    thread.join(timeout=10)
    assert not thread.is_alive()
    assert request == ["CONNECT repo.example:443 HTTP/1.0"], request
    assert tunneled.returncode == 0 and tunneled.stdout == b"SSH-2.0-Synthetic\r\n", tunneled.stderr
print(json.dumps({"uid": os.getuid(), "sshAgent": "stdin key loaded", "proxy": "CONNECT passed host and port"}))
`;

/** Offline, non-root exercise of the tools used by repository-scoped SSH. */
export async function checkSshTools(image: string, uid: 65534 | 10001) {
  return await capture([
    'docker',
    'run',
    '--rm',
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--memory',
    '128m',
    '--pids-limit',
    '32',
    '--user',
    `${uid}:${uid}`,
    '--tmpfs',
    `/tmp:uid=${uid},gid=${uid},mode=700`,
    '--env',
    'PYTHONDONTWRITEBYTECODE=1',
    '--entrypoint',
    'python',
    image,
    '-c',
    SSH_CHECK,
  ]);
}
