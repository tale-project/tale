---
title: Install
description: Pick the right Tale install path — a laptop trial with the CLI, a hardened production install on a Linux host, or the raw Docker Compose reference for full control.
---

Installing Tale has three shapes, and the right one depends on what you are doing with the result. This page routes you to the path that fits — a quick local trial, a production install behind TLS, or the raw Compose reference when you want to own every knob — so you do not start down a hardening walk when you only wanted to click around.

All three paths land on the same product; the difference is how much of the stack you operate and how durable the result needs to be. The CLI wraps Docker Compose for the first two so there is nothing to hand-edit, while the reference path is for teams who run Compose themselves.

## Trying Tale on a laptop

If you want a running instance to click through — on your own machine, with no domain and no hardening — the [Quickstart](/self-hosted/install/quickstart) is the path. Install the CLI, run `tale init` then `tale start`, and you are signed into your own org in minutes. The CLI provisions Docker if it is missing, generates every secret, and bind-mounts your config so edits reload live. This is the right path for an evaluation, a demo, or local development against a real stack.

When you outgrow the laptop and want the same project on a real host, the trial project carries over — `tale deploy` takes it to a domain without re-initialising.

## Running Tale in production

When real traffic will land on the instance, the [Linux server](/self-hosted/install/linux-server) walk is the path. It covers TLS, a firewall, a non-root user, the reverse proxy, and the operational hooks you want before you point a domain at it. The CLI still does the heavy lifting — `tale deploy` runs a blue-green, zero-downtime rollout with health checks and rollback — but this walk adds the host-level setup that a trial skips.

After the first deploy, [First admin](/self-hosted/install/first-admin) explains the one-time owner-account setup and how to close signup once your team is in, and [CLI install](/self-hosted/install/cli-install) sets up the CLI on a workstation to deploy and upgrade a remote instance.

## Owning the Compose layer

If you would rather run the stack from a clone of the repository and manage Compose yourself — for transparency, air-gapped builds, or your own automation — the [Docker Compose reference](/self-hosted/install/docker-compose-reference) is the path. It documents the base file and the overlays the CLI generates under the hood, so you can reproduce or extend them by hand. This is the most control and the most work; most teams are better served by the CLI paths above.

This path pairs with the [Linux server](/self-hosted/install/linux-server) walk for the host-level pieces (TLS, firewall, user) that Compose alone does not cover.

## Where this fits

The three install paths trade convenience for control: the [Quickstart](/self-hosted/install/quickstart) is the fastest way to a running instance, the [Linux server](/self-hosted/install/linux-server) walk hardens it for real traffic, and the [Docker Compose reference](/self-hosted/install/docker-compose-reference) hands you every knob when the CLI's defaults are not enough. Pick by durability: a trial you will throw away wants the quickstart; an instance your team depends on wants the production walk.

Once installed, the [Configuration](/self-hosted/configuration/environment-reference) pages are the source of truth for every environment variable and provider file, and the [Operate](/self-hosted/operate/container-architecture) section covers upgrades, backups, and observability for the running stack.
