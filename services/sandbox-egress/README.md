# @tale/sandbox-egress

Tale sandbox egress proxy — `tinyproxy` fronted by an IP-layer SSRF firewall.
All outbound traffic from sandbox-runtime containers is forced through this
proxy; `iptables` REJECT rules block the cloud metadata endpoint (IMDS) and
RFC1918 ranges so sandboxed code cannot reach the host network or credentials.

Egress is open at the hostname layer by default — the IP-layer firewall is the
hard boundary. The entrypoint fails closed: if the firewall rules cannot be
installed, the proxy refuses to start.

```bash
bun run --filter @tale/sandbox-egress serve         # docker compose up sandbox-egress
bun run --filter @tale/sandbox-egress docker:build
```

## Container

Runs as root so the entrypoint can `chown` the log dir and install `iptables`
rules; `tinyproxy` drops privileges to `nobody` at bind time. `docker-entrypoint.sh`
(PID 1) installs the SSRF firewall, then `exec`s `entrypoint.sh` which renders
the tinyproxy config and `exec`s tinyproxy. See the script headers for details.
