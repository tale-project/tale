# @tale/sandbox-egress

Tale sandbox egress proxy — `tinyproxy` fronted by an IP-layer SSRF firewall.
All outbound traffic from sandbox-runtime containers is forced through this
proxy; `iptables` REJECT rules block the cloud metadata endpoint (IMDS) and
private destinations, with an exact-address DNS exception for configured
upstream resolvers.

`SANDBOX_EGRESS_DENIED_HOSTS` keeps egress open and refuses the hosts it names:
a list of host names separated by commas or `|` (for example
`registry.npmjs.org,registry.yarnpkg.com,pypi.org,files.pythonhosted.org`), each
also covering its subdomains. A request for one gets `403` from the proxy
(a `CONNECT` tunnel fails with the same status), and the DNS forwarder answers it
`NXDOMAIN`, so a client that resolves through the proxy and then connects by
address fails at the name. It is for a deployment whose sessions install from
package caches of their own (the Incus backend's `SANDBOX_INCUS_NPM_REGISTRY` and
`SANDBOX_INCUS_PYPI_INDEX`): a package manager that ignores its configuration
then fails visibly instead of installing around the cache. Entries are host
names, not regular expressions, and the entrypoint refuses to start on a value
that is not a plain host name with a domain, on a list that names none, and when
`SANDBOX_EGRESS_ALLOWLIST` is also set (an allow-list already refuses every host
it does not name). Recreate the service to apply a change: the list reaches the
container through its environment file, which a restart does not read again.

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
and a runtime's default soft limit can be 1024), and when even that cannot
hold them, lowers `MaxClients` to the connections the limit holds (two
descriptors each above 64 for the rest, at least 1) and warns with the value
it serves. Both compose pipelines pass the same default and size the
container's pids (4096) and open files (8192/16384) for it; a higher value
needs those raised with it. On Kubernetes the threads count against the
node's `podPidsLimit`. The idle tunnel `Timeout` stays at 600 s.

`SANDBOX_EGRESS_MAX_CONNECTIONS_PER_SESSION` (256 by default) caps what one
client address holds open on the proxy port at once, so a single session
cannot take that whole pool from the others: `docker-entrypoint.sh` adds one
`iptables` rule on `INPUT` for new TCP connections to port 3128
(`-m connlimit --connlimit-above N --connlimit-mask 32 -j REJECT --reject-with tcp-reset`),
only when the rule is not there yet. With transparent egress every connection
of a session, its nested containers' included, comes from the session's one
address (on Kubernetes, its Pod's, unless the cluster network rewrites source
addresses: sessions behind one shared address share one cap, so set `0`
there), and each build helper has an address of its own; a connection past
the cap is reset at once instead of waiting out a timeout. `0` turns the cap
off, and a value that is no whole number refuses the start. The cap is
fairness, not a security boundary, so it fails open: a kernel without the
`connlimit` match, or a development run without `NET_ADMIN`, starts the proxy
without it and logs a warning.

`OUTBOUND_PROXY_URLS` sends the sessions' traffic on through the deployment's
outbound proxies instead of from this host's own address: HTTP proxies written
`http://[user:password@]host[:port]`, separated by commas or whitespace, the
same value the backend reads for the crawler, the chat assistant's web fetch,
email images and video ingestion. Set, the entrypoint starts a squid hop on
`127.0.0.1:3129` and renders tinyproxy's `Upstream http 127.0.0.1:3129`, so
tinyproxy's filters, client ACL, `MaxClients` and the per-session cap still
apply before a request leaves. tinyproxy then dials only the hop, so the
firewall no longer sees where a request goes: squid refuses the same
destinations itself before any proxy is asked (loopback, private networks,
link-local and the metadata address, in any form a client writes them,
`2130706433` and names that resolve to one included), as well as a name it
cannot resolve and any IPv6 address (the container has no IPv6, and tinyproxy
rewrites an IPv6 host before squid sees it). It answers the health probe's
request for tinyproxy itself that way, so the probe exercises the hop and never
leaves the container. squid's cache manager is closed: it
would show the proxies' passwords and every session's requests in flight. squid hands each connection to the next proxy in
turn (`round-robin`) and never to a destination directly (`never_direct`); it
retries a connection a proxy refuses or times out through the next one, marks a
proxy dead after two failed connections, and uses it again once a probe finds
it answering. tinyproxy keeps one upstream at most, which is why the hop exists.
`outbound-proxies.awk` reads the list with the backend's grammar and refusals
(`@tale/shared/net/outbound-proxies`; the platform's
`tests/guards/outbound-proxies.guard.test.ts` runs both over the same entries),
so a malformed entry stops the start, naming its position and never its text.
The rendered `/etc/sandbox-egress/squid.conf` holds the passwords: it is
written `0600` and never printed, and the start log lists the proxies as
`http://host:port` only. squid sends no `Via` or `X-Forwarded-For` header. Its
`-d 1` messages reach the container log: `Detected DEAD Parent: outbound-<n>`
and `Detected REVIVED Parent: outbound-<n>` name a proxy by its position in the
list, and with IPv6 switched off as above, `BCP 177 violation. Detected
non-functional IPv6 loopback.` and five `aclIpParseIpData: IPv6 has not been
enabled.` lines (the IPv6 entries of its destination rules) appear once at
start, as expected. A destination squid cannot resolve itself, a host with
IPv6 addresses only included, is refused rather than handed to a proxy. Name proxies
at public addresses: the SSRF firewall rejects private destinations for squid
as for everything else. They must accept tunnels (`CONNECT`) to ports 443 and
80, since nested containers' plain HTTP reaches them through redsocks as a
tunnel to port 80. Both readers refuse a user name and password longer than
128 bytes together once decoded, squid's limit for a parent's login
(`MAX_LOGIN_SZ`), past which it crashes on the first request. Unset or blank, nothing changes: no hop starts, and
tinyproxy connects to destinations itself.

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
the config, supervises foreground Tinyproxy and DNS (and the squid hop, when
outbound proxies are listed), forwards shutdown signals, and reaps the
children. It tracks the child PIDs directly, so Tinyproxy needs no PID file or
write access to `/tmp`; squid keeps no PID or log file either. When a daemon
exits on its own, the shell stops the others and exits non-zero, so the restart
policy brings the container back whole: nested containers and BuildKit `RUN`
steps resolve names only through dnsmasq, so a proxy serving without it would
be a silent DNS outage for every session, and a Tinyproxy without its hop would
fail every request. squid reads its root-only config as root and then serves as
the `squid` user. The health check asks both: an HTTP request to
Tinyproxy and a busybox `nslookup` against 127.0.0.1 for
`sandbox-egress-health.invalid`, a name dnsmasq answers from its own
`--host-record` without an upstream lookup. dnsmasq caches 4096 names (its
default is 150), since the whole fleet resolves through it. The container smoke suite boots with a
read-only `/tmp` and checks startup, graceful stop and the same container's
restart. The root supervisor needs `KILL` to signal Tinyproxy after it changes
user to `nobody`; the proxy itself retains no effective capabilities.
