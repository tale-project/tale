# Incus runtime

> **Prefix** `INC-` · **Reset** a fresh host, where a group says so · **Cost** per group, in its heading

A Tale deployment that runs as Incus instances instead of Docker Compose
containers, driven with the compiled `tale` on real hosts: the bootstrap of a
fresh Ubuntu host, certificates from Let's Encrypt through the instances' proxy
devices, a host reboot under a running deployment, a migration between two
hosts, whether an operator can read what `tale status` and `tale logs` print,
and `tale stop` before host maintenance. A change that ships one of these
behaviours adds its boxes here, in its own group, in the same commit
([readme](../readme.md#changing-the-suites)).

**Groups follow the life of a host — bootstrap, deploy, operate, recover,
migrate — and each one names the state it starts from**: a fresh host, or what
an earlier group left. A group that consumes an earlier group's state says so
in its heading, and its boxes run in order.

## Preconditions

The binary under test and the hosts per [`../setup.md`](../setup.md). Docker
Compose stays a host's default runtime; a box that needs Incus says how its host
gets it.

> **Agent note**: judge a host by what the runtime and `tale status` report
> after a command returns, never by the command's own success line — an
> instance that was created and an instance that serves are different states.
