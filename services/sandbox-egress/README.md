# @tale/sandbox-egress

Tale sandbox egress proxy — `tinyproxy` fronted by an IP-layer SSRF firewall.
All outbound traffic from sandbox-runtime containers is forced through this
proxy; `iptables` REJECT rules block the cloud metadata endpoint (IMDS) and
private destinations, with an exact-address DNS exception for configured
upstream resolvers.

The entrypoint validates literal nameserver addresses from `/etc/resolv.conf`
and permits UDP/TCP destination port 53 to those exact IPs, so a private
Kubernetes DNS Service can resolve upstream names. It does not allow the
resolver's subnet or other private destination ports. IPv6 resolver exceptions
require working IPv6 filtering; the forwarding guard remains unchanged.

Egress is open at the hostname layer by default — the IP-layer firewall is the
hard boundary. The entrypoint fails closed: if the firewall rules cannot be
installed, the proxy refuses to start. IPv4 and enabled IPv6 forwarding are
blocked at the top of the FORWARD chain, so the multi-network proxy cannot
route packets between organizations' private build-cache networks.

Compose and the deployment generator disable IPv6 with
`net.ipv6.conf.all.disable_ipv6=1` and
`net.ipv6.conf.default.disable_ipv6=1`. Keep both sysctls in custom Docker
definitions so IPv4-only hosts do not require an IPv6 firewall module. The
entrypoint still checks actual interface state before accepting the disabled
IPv6 fallback.

Kubernetes requires working IPv6 netfilter support or IPv6 disabled in the
egress Pod's network namespace. If the IPv6 firewall is unavailable, the
entrypoint attempts that local disable and verifies the default plus every
interface. It still refuses startup when a read-only `/proc/sys` or denied
write leaves IPv6 enabled without protection. The spawner does not add unsafe
Pod sysctls or extra capabilities; configure the prerequisite through the
cluster's permitted settings. See the
[Kubernetes contract](../sandbox/docs/kubernetes.md#egress-ipv6-prerequisite).

The proxy serves `SANDBOX_EGRESS_MAX_CLIENTS` connections at once (tinyproxy
`MaxClients`, 2000 by default) for every session together: with transparent
egress, each outbound connection of a session, its builds and its package
installs is one of them. The entrypoint refuses to start on a value that is no
whole number above 0, raises the soft open-file limit to two descriptors per
connection as far as the hard limit allows (a Kubernetes Pod spec sets none,
and a runtime's default soft limit can be 1024), and warns when even that
cannot hold them. Both compose pipelines pass the same default and size the
container's pids (4096) and open files (8192/16384) for it; a higher value
needs those raised with it. On Kubernetes the threads count against the
node's `podPidsLimit`. The idle tunnel `Timeout` stays at 600 s.

```bash
bun run --filter @tale/sandbox-egress serve         # docker compose up sandbox-egress
bun run --filter @tale/sandbox-egress docker:build
```

## Container

Runs as root so the entrypoint can install `iptables` rules and dnsmasq can
bind port 53; `tinyproxy` drops privileges to `nobody` after binding and logs
to stdout (the container log), so no log file grows in the container's writable
layer. `docker-entrypoint.sh`
(PID 1) installs the SSRF firewall, then `exec`s `entrypoint.sh`. That shell renders
the config, supervises foreground Tinyproxy and DNS, forwards shutdown signals,
and reaps both children. It tracks the child PID directly, so Tinyproxy needs no
PID file or write access to `/tmp`. The container smoke suite boots with a
read-only `/tmp` and checks startup, graceful stop and the same container's
restart. The root supervisor needs `KILL` to signal Tinyproxy after it changes
user to `nobody`; the proxy itself retains no effective capabilities.
