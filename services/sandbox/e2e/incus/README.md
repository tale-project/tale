# Sandbox on Incus: end-to-end against a real node

The unit tests of the Incus backend (`src/backend/incus`) run it against an
in-memory imitation of the Incus API. This directory is what shows the
imitation right: the same spawner, driven through its signed HTTP API, against
a real Incus node built the way [docs/incus.md](../../docs/incus.md) tells an
operator to build one.

It runs in CI (`.github/workflows/sandbox-incus-e2e.yml`) on a hosted Linux
runner. It reconfigures its host (packages, a ZFS pool, the firewall, Incus
itself), so it is only ever run on a throwaway machine.

## The lab

`lab.sh` builds the node, one subcommand per workflow step:

| Step       | What it makes                                                                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `install`  | Incus from Zabbly's stable channel (key fingerprint and exact build pinned), skopeo, ZFS                                                                              |
| `storage`  | a ZFS pool on a sparse file, registered as the Incus pool `tank`                                                                                                      |
| `api`      | the server certificate Bun can pin (self-signed, `CA:TRUE`, `pathlen:0`, `keyCertSign`), the API bound to it, the spawner's client key, and two foreign certificates   |
| `registry` | a local OCI registry, which the two images are pushed to and Incus pulls from                                                                                         |
| `operator` | the block of docs/incus.md that follows `<!-- e2e:operator-setup -->`, run verbatim: the sandbox bridge, the restricted project, the ACL, the profile, the certificate |
| `egress`   | Tale's own `sandbox-egress` image as an instance on the sandbox bridge, and the addresses of the LLM gateway and backend stand-ins                                    |

The runtime and egress images are built from the checkout by the workflow
(BuildKit, as a release builds them) and pushed to the registry; the spawner
pulls the runtime image itself (`SANDBOX_INCUS_IMAGE_SOURCE`), so the pull the
unit tests cannot vouch for is part of every run.
