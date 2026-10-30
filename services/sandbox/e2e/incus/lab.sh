#!/usr/bin/env bash
# services/sandbox/e2e/incus/lab.sh
#
# Builds, on a THROWAWAY Ubuntu host, the Incus node that
# services/sandbox/docs/incus.md tells an operator to create, so the end-to-end
# suites in this directory can drive the real Incus backend of the sandbox
# spawner against it. Each subcommand is one step of the workflow
# (.github/workflows/sandbox-incus-e2e.yml) and leaves its duration in
# phases.tsv, which the job summary reports.
#
#   install    Incus from Zabbly's stable channel (key fingerprint and exact
#              build pinned), skopeo and ZFS
#   storage    a ZFS pool on a loop file, registered as the Incus pool `tank`
#   api        the server certificate Bun can pin, the API bound to it, the
#              spawner's client key and two foreign certificates for the
#              boot-refusal tests
#   registry   a local OCI registry the two images are pushed to
#   operator   the operator's block of docs/incus.md, verbatim
#   egress     Tale's own sandbox-egress image as an instance on the sandbox
#              bridge, and the stand-ins for the LLM gateway and the backend
#   events     records the node's instance lifecycle events (who created,
#              started, stopped and deleted what) in the background
#   next-context  the build context of the "next version" of the runtime image
#              (the current image and one file more), for the upgrade suite
#   lab-file   writes lab.json, which the suites read
#   facts      host facts and phase durations, as Markdown
#   diagnose   what a failed run needs to be read afterwards
#   env        KEY=VALUE lines for $GITHUB_ENV
#   suites     the choice of suites (`all`, or a comma-separated list) as
#              `<suite>=true|false` lines for $GITHUB_OUTPUT
#
# It reconfigures the host (packages, ZFS, the firewall, Incus itself): CI, or
# TALE_INCUS_E2E_THROWAWAY_HOST=1 on a VM you can lose. The images are pushed to
# the registry by the workflow's own buildx steps, not here.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---- pins ----------------------------------------------------------------------
# Zabbly's `stable` channel, the one the application node runs: native OCI
# containers take static addresses only from 7.2. Its signing key by
# fingerprint, and the exact builds read from its package index. It keeps two
# builds per channel: when a pin ages out, `install` takes the channel's newest
# build of the same Incus version and warns to re-pin, so a required check does
# not fail on the index alone; another Incus version still fails, listing what
# the index has now.
readonly ZABBLY_KEY_FINGERPRINT=4EFC590696CB15B87C73A3AD82CC8797C838DCFD
readonly INCUS_VERSION_NOBLE="${INCUS_VERSION_NOBLE:-1:7.5.1-ubuntu24.04-202610270033}"
readonly INCUS_VERSION_RESOLUTE="${INCUS_VERSION_RESOLUTE:-1:7.5.1-ubuntu26.04-202610262256}"
# The CNCF distribution registry, by digest.
readonly REGISTRY_IMAGE='ghcr.io/distribution/distribution:3.0.0@sha256:4ba3adf47f5c866e9a29288c758c5328ef03396cb8f5f6454463655fa8bc83e2'

# ---- names ---------------------------------------------------------------------
# These are the names of docs/incus.md's example (operator-block.test.ts keeps
# the two in step).
readonly PROJECT=sandbox-pr
readonly PROFILE=sandbox
readonly NETWORK=sbx0
readonly POOL=tank
readonly ACL=sandbox-egress
readonly CLIENT_NAME=tale-sandbox-pr
readonly IMAGE_ALIAS=tale-sandbox-runtime
readonly BRIDGE_ADDRESS=10.20.0.1
readonly EGRESS_ADDRESS=10.20.0.2
readonly GATEWAY_ADDRESS=10.20.0.3
readonly BACKEND_ADDRESS=10.20.0.4

# ---- the lab's own ---------------------------------------------------------------
readonly API_PORT=8443
readonly REGISTRY_ADDRESS=127.0.0.1:5000
readonly RUNTIME_IMAGE="${REGISTRY_ADDRESS}/tale-sandbox-runtime:e2e"
readonly RUNTIME_IMAGE_NEXT="${REGISTRY_ADDRESS}/tale-sandbox-runtime:e2e-next"
readonly EGRESS_IMAGE="${REGISTRY_ADDRESS}/tale-sandbox-egress:e2e"
readonly EGRESS_INSTANCE=egress
readonly EGRESS_ALIAS=tale-sandbox-egress
readonly ZPOOL=e2e
readonly POOL_SIZE="${INCUS_E2E_POOL_SIZE:-48G}"
# The suites of ./suites, in the order the workflow runs them (workflow.test.ts
# keeps the three in step).
readonly SUITES=(boot lifecycle fencing network pool reaping adoption failures limits docker upgrade soak)

dir="${INCUS_E2E_DIR:-/mnt/tale-incus-e2e}"
pki="$dir/pki"

log() { printf '[lab] %s\n' "$*"; }
die() {
  printf '::error::%s\n' "$*" >&2
  exit 1
}

guard() {
  if [ "${CI:-}" != true ] && [ "${TALE_INCUS_E2E_THROWAWAY_HOST:-}" != 1 ]; then
    die 'this reconfigures the host (packages, ZFS, the firewall, Incus): run it in CI, or on a throwaway VM with TALE_INCUS_E2E_THROWAWAY_HOST=1'
  fi
  if [ "$(uname -s)" != Linux ]; then
    die 'the lab needs a Linux host'
  fi
}

# The lab's directory is the runner user's, wherever it sits (/mnt is root's).
ensure_dir() {
  if [ ! -d "$dir" ]; then
    sudo mkdir -p "$dir"
    sudo chown "$(id -u):$(id -g)" "$dir"
  fi
}

# Incus is the administrator's here: the local socket, as root. The function
# also stands in for the `incus` the operator block calls.
incus() { sudo /usr/bin/incus "$@"; }
export -f incus

# One step: its name, how long it took and how it ended go to phases.tsv. The
# step runs in a subshell of its own that is not a condition, so errexit holds
# inside it (a function called on the left of `||` would run with it off).
phase() {
  local name="$1" started="$SECONDS" status
  shift
  echo "::group::lab $name"
  set +e
  (
    set -e
    "$@"
  )
  status=$?
  set -e
  printf '%s\t%s\t%s\n' "$name" "$((SECONDS - started))" "$status" >>"$dir/phases.tsv"
  echo '::endgroup::'
  return "$status"
}

# ---- install ---------------------------------------------------------------------

install_incus() {
  local codename version key fingerprint builds upstream newest
  # shellcheck source=/dev/null
  codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"
  case "$codename" in
    noble) version="$INCUS_VERSION_NOBLE" ;;
    resolute) version="$INCUS_VERSION_RESOLUTE" ;;
    *) die "no pinned Incus build for Ubuntu $codename: pin one in lab.sh" ;;
  esac

  sudo install -d -m 0755 /etc/apt/keyrings
  key="$(mktemp)"
  curl -fsSL --retry 3 https://pkgs.zabbly.com/key.asc -o "$key"
  fingerprint="$(gpg --show-keys --with-colons "$key" | awk -F: '$1 == "fpr" { print $10; exit }')"
  if [ "$fingerprint" != "$ZABBLY_KEY_FINGERPRINT" ]; then
    die "Zabbly's key is $fingerprint, not the pinned $ZABBLY_KEY_FINGERPRINT"
  fi
  sudo install -m 0644 "$key" /etc/apt/keyrings/zabbly.asc
  rm -f "$key"
  printf 'Enabled: yes\nTypes: deb\nURIs: https://pkgs.zabbly.com/incus/stable\nSuites: %s\nComponents: main\nArchitectures: amd64\nSigned-By: /etc/apt/keyrings/zabbly.asc\n' "$codename" |
    sudo tee /etc/apt/sources.list.d/zabbly-incus-stable.sources >/dev/null
  sudo apt-get update -q

  # Read whole, then searched: `grep -q` leaving early would fail the pipe.
  builds="$(apt-cache madison incus)"
  if ! grep -qF "| $version |" <<<"$builds"; then
    # The pin without its build stamp: `1:7.5.1-ubuntu26.04`.
    upstream="${version%-*}"
    newest="$(awk -F'|' -v prefix="$upstream-" '{ gsub(/ /, "", $2) } index($2, prefix) == 1 { print $2 }' <<<"$builds" | sort -V | tail -n 1)"
    if [ -z "$newest" ]; then
      echo "$builds" >&2
      die "Zabbly's stable channel no longer has incus $version or another build of $upstream: read the builds above, take a current one and pin it in lab.sh"
    fi
    printf '::warning::%s\n' "Zabbly's stable channel no longer has incus $version; installing its build $newest instead. Pin $newest in lab.sh."
    version="$newest"
  fi
  # skopeo is what Incus pulls an OCI image with; zfsutils-linux the pool's.
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends \
    "incus=$version" "incus-base=$version" "incus-client=$version" \
    skopeo zfsutils-linux jq

  if ! sudo modprobe zfs; then
    log "no zfs module for $(uname -r); trying its extra modules"
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q "linux-modules-extra-$(uname -r)" || true
    sudo modprobe zfs || die "this kernel ($(uname -r)) has no ZFS module: the lab's pool needs one"
  fi
  incus admin waitready --timeout 120
  incus version
}

# ---- storage ----------------------------------------------------------------------

init_storage() {
  df -h "$dir" || true
  truncate -s "$POOL_SIZE" "$dir/pool.img"
  sudo zpool create -f -o ashift=12 -O atime=off -O compression=lz4 "$ZPOOL" "$dir/pool.img"
  sudo zfs create "$ZPOOL/incus"
  incus admin init --preseed <<YAML
storage_pools:
  - name: $POOL
    driver: zfs
    config:
      source: $ZPOOL/incus
profiles:
  - name: default
    devices:
      root:
        path: /
        pool: $POOL
        type: disk
YAML
  # The runner ships Docker, whose FORWARD policy is DROP: that would break the
  # NAT of every Incus bridge (the node has no Docker).
  sudo iptables -P FORWARD ACCEPT
  incus storage list
}

# ---- the API ------------------------------------------------------------------------

# The certificate hostkit gives every Incus host: a client whose TLS is
# BoringSSL's (Bun's fetch) can pin it as its own anchor, which Incus's own
# (CA:FALSE) cannot be. Self-signed, CA:TRUE with pathlen:0, keyCertSign,
# serverAuth, the API's addresses as names, a P-384 key.
make_server_certificate() {
  local crt="$1" key="$2" names='' conf address
  shift 2
  for address in "$@"; do
    names+="${names:+, }IP:$address"
  done
  conf="$(mktemp)"
  cat >"$conf" <<CONF
[req]
distinguished_name = subject
x509_extensions = server
prompt = no

[subject]
O = Tale
CN = incus

[server]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, digitalSignature, keyEncipherment, keyCertSign
extendedKeyUsage = serverAuth
subjectKeyIdentifier = hash
subjectAltName = $names
CONF
  # The key of a throwaway lab's server, read unattended by Incus: no passphrase.
  # nosemgrep: tools.opengrep.rules.trailofbits.generic.openssl-insecure-flags.openssl-insecure-flags -- intentional: a CI lab certificate on a host that is thrown away after the run
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:secp384r1 -nodes \
    -days 3650 -config "$conf" -keyout "$key" -out "$crt"
  rm -f "$conf"
  chmod 0600 "$key"
}

serve_api() {
  mkdir -p "$pki"
  # Incus's own certificate, as the daemon made it: the boot test that must
  # refuse an unpinnable server certificate presents this one.
  sudo cp /var/lib/incus/server.crt "$pki/incus-default-server.crt"
  sudo chown "$(id -u):$(id -g)" "$pki/incus-default-server.crt"

  # Made once, before the API is first bound, so no client can have pinned the
  # certificate it replaces.
  make_server_certificate "$pki/server.crt" "$pki/server.key" 127.0.0.1 "$BRIDGE_ADDRESS"
  sudo install -m 0644 -o root -g root "$pki/server.crt" /var/lib/incus/server.crt
  sudo install -m 0600 -o root -g root "$pki/server.key" /var/lib/incus/server.key
  rm -f "$pki/server.key"
  sudo systemctl restart incus.service
  incus admin waitready --timeout 120
  incus config set core.https_address ":$API_PORT"

  # A second certificate of the same shape: the wrong anchor.
  make_server_certificate "$pki/other-server.crt" "$pki/other-server.key" 127.0.0.1 "$BRIDGE_ADDRESS"

  # The spawner's client certificate. The operator block trusts it, restricted.
  # nosemgrep: tools.opengrep.rules.trailofbits.generic.openssl-insecure-flags.openssl-insecure-flags -- intentional: the spawner's lab client key is read unattended, on a host that is thrown away after the run
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:secp384r1 -nodes \
    -days 3650 -subj "/CN=$CLIENT_NAME" -addext 'extendedKeyUsage=clientAuth' \
    -keyout "$pki/client.key" -out "$pki/client.crt"
  chmod 0600 "$pki/client.key"

  # The daemon serves what was made, and plain OpenSSL verification with it as
  # the only anchor passes for the address a client dials.
  local served made
  served="$(echo | openssl s_client -connect "127.0.0.1:$API_PORT" 2>/dev/null | openssl x509 -noout -fingerprint -sha256)"
  made="$(openssl x509 -in "$pki/server.crt" -noout -fingerprint -sha256)"
  [ "$served" = "$made" ] || die "the daemon serves $served, not the certificate made here ($made)"
  echo | openssl s_client -connect "127.0.0.1:$API_PORT" -CAfile "$pki/server.crt" \
    -verify_ip 127.0.0.1 -verify_return_error 2>&1 | grep -F 'Verification: OK' ||
    die 'the made certificate does not verify as its own anchor'
  openssl x509 -in "$pki/server.crt" -noout -ext basicConstraints,keyUsage,extendedKeyUsage,subjectAltName
}

# ---- the registry ---------------------------------------------------------------------

start_registry() {
  mkdir -p "$dir/registry"
  docker run -d --name e2e-registry --restart unless-stopped \
    -p "127.0.0.1:${REGISTRY_ADDRESS##*:}:5000" \
    -v "$dir/registry:/var/lib/registry" "$REGISTRY_IMAGE"
  # Incus pulls an OCI image with skopeo, as root, and this registry speaks
  # plain HTTP on the loopback.
  sudo install -d -m 0755 /etc/containers/registries.conf.d
  printf '[[registry]]\nlocation = "%s"\ninsecure = true\n' "$REGISTRY_ADDRESS" |
    sudo tee /etc/containers/registries.conf.d/50-incus-e2e.conf >/dev/null
  local attempt
  for attempt in $(seq 1 30); do
    if curl -fsS --max-time 2 "http://${REGISTRY_ADDRESS}/v2/" >/dev/null; then
      log "registry up after $attempt attempt(s)"
      return 0
    fi
    sleep 1
  done
  docker logs e2e-registry || true
  die 'the local registry never answered'
}

# ---- the operator's setup ---------------------------------------------------------------

operator_setup() {
  local block
  block="$(bun "$here/operator-block.ts")"
  echo "$block"
  # Verbatim, as an administrator, with the client certificate at hand.
  (cd "$pki" && bash -euo pipefail -c "$block")
  incus project show "$PROJECT"
  incus network show "$NETWORK"
  incus network acl show "$ACL"
  incus config trust list
}

# ---- the egress proxy and the stand-ins -----------------------------------------------------

host_resolvers() {
  local file=/run/systemd/resolve/resolv.conf
  [ -r "$file" ] || file=/etc/resolv.conf
  awk '$1 == "nameserver" && $2 ~ /^[0-9]+[.][0-9]+[.][0-9]+[.][0-9]+$/ && $2 !~ /^127[.]/ { print $2 }' "$file" | paste -sd, -
}

start_egress() {
  local resolvers attempt
  resolvers="$(host_resolvers)"
  resolvers="${resolvers:-1.1.1.1}"
  log "the proxy resolves through $resolvers"

  # The administrator's way in for an OCI image, as docs/incus.md gives it.
  incus remote add e2e-registry "https://${REGISTRY_ADDRESS}" --protocol=oci
  incus image copy "e2e-registry:tale-sandbox-egress:e2e" local: --alias "$EGRESS_ALIAS"

  # An instance of the default project on the sandbox bridge, at the address the
  # ACL names. The bridge resolves nothing, so the proxy is told its upstream.
  incus init "$EGRESS_ALIAS" "$EGRESS_INSTANCE" --network "$NETWORK" \
    -c "oci.dns.nameservers=$resolvers"
  incus config device set "$EGRESS_INSTANCE" eth0 "ipv4.address=$EGRESS_ADDRESS"
  incus start "$EGRESS_INSTANCE"

  # The image's own health probe: tinyproxy answers its 400 page.
  for attempt in $(seq 1 60); do
    if incus exec "$EGRESS_INSTANCE" -- curl -sS -o /dev/null --max-time 3 --noproxy '*' http://127.0.0.1:3128/; then
      log "the egress proxy answers after $attempt attempt(s)"
      break
    fi
    if [ "$attempt" = 60 ]; then
      incus info "$EGRESS_INSTANCE" --show-log || true
      incus console "$EGRESS_INSTANCE" --show-log || true
      die 'the egress proxy never answered'
    fi
    sleep 2
  done
  incus list "$EGRESS_INSTANCE" -c n4s

  # From the node, through the proxy, the internet.
  curl -sS --max-time 40 --proxy "http://${EGRESS_ADDRESS}:3128" -o /dev/null \
    -w 'through the proxy: %{http_code}\n' https://github.com ||
    die 'the egress proxy did not carry a request to the internet'

  # The LLM gateway and the backend are the node's own addresses in this lab:
  # the suites serve the two ports the ACL names on them. They sit on a dummy
  # link of their own (the host answers ARP for them on the bridge all the
  # same), so that the bridge keeps the one address a real node's has: when it
  # releases a lease, Incus sends the release to the last address of the bridge.
  sudo ip link add lab-stand type dummy
  sudo ip link set lab-stand up
  sudo ip addr add "${GATEWAY_ADDRESS}/32" dev lab-stand
  sudo ip addr add "${BACKEND_ADDRESS}/32" dev lab-stand
  ip -br addr show dev lab-stand
  ip -br addr show dev "$NETWORK"
}

# ---- the node's events ----------------------------------------------------------------------

# What the node did, as it says so itself: every lifecycle event of an instance
# (created, started, stopped, deleted) names who asked, so that an instance that
# vanished during its create can be traced to the caller that deleted it.
record_events() {
  mkdir -p "$dir/logs"
  # The file is the runner's own (the redirect is meant to run as the runner).
  # shellcheck disable=SC2024
  sudo -b /usr/bin/incus monitor --type=lifecycle --all-projects --format=json \
    >"$dir/logs/incus-events.jsonl" 2>&1 </dev/null
  sleep 1
  log "recording lifecycle events to $dir/logs/incus-events.jsonl"
}

# ---- the next version -----------------------------------------------------------------------

# The build context of the runtime image's "next version": the current image and
# one file more, so that it is another image to Incus (another fingerprint) with
# everything else the same. The workflow builds it into the local registry
# beside the current one, a layer on layers the registry already holds.
next_context() {
  local context="$dir/next"
  mkdir -p "$context"
  cat >"$context/Dockerfile" <<'DOCKERFILE'
ARG BASE
FROM ${BASE}
COPY version /usr/share/tale-e2e-version
DOCKERFILE
  printf 'next\n' >"$context/version"
  echo "the next version's context is $context"
}

# ---- the files ----------------------------------------------------------------------------

write_lab_file() {
  mkdir -p "$dir/logs" "$dir/report"
  jq -n \
    --arg stateDir "$dir" \
    --arg endpoint "https://127.0.0.1:${API_PORT}" \
    --arg project "$PROJECT" --arg profile "$PROFILE" --arg network "$NETWORK" \
    --arg pool "$POOL" --arg acl "$ACL" --arg image "$IMAGE_ALIAS" \
    --arg imageSource "$RUNTIME_IMAGE" --arg imageSourceNext "$RUNTIME_IMAGE_NEXT" \
    --arg clientCertFile "$pki/client.crt" --arg clientKeyFile "$pki/client.key" \
    --arg serverCertFile "$pki/server.crt" \
    --arg defaultServerCertFile "$pki/incus-default-server.crt" \
    --arg otherServerCertFile "$pki/other-server.crt" \
    --arg egressProxy "http://${EGRESS_ADDRESS}:3128" \
    --arg bridgeAddress "$BRIDGE_ADDRESS" --arg egressAddress "$EGRESS_ADDRESS" \
    --arg gatewayAddress "$GATEWAY_ADDRESS" --arg backendAddress "$BACKEND_ADDRESS" \
    --arg egressInstance "$EGRESS_INSTANCE" --arg egressImage "$EGRESS_ALIAS" \
    '{stateDir: $stateDir, endpoint: $endpoint, project: $project, profile: $profile,
      network: $network, pool: $pool, acl: $acl, image: $image,
      imageSource: $imageSource, imageSourceNext: $imageSourceNext,
      clientCertFile: $clientCertFile,
      clientKeyFile: $clientKeyFile, serverCertFile: $serverCertFile,
      defaultServerCertFile: $defaultServerCertFile,
      otherServerCertFile: $otherServerCertFile, egressProxy: $egressProxy,
      bridgeAddress: $bridgeAddress, egressAddress: $egressAddress,
      gatewayAddress: $gatewayAddress, backendAddress: $backendAddress,
      egressInstance: $egressInstance, egressImage: $egressImage}' >"$dir/lab.json"
  cat "$dir/lab.json"
}

# ---- reading ----------------------------------------------------------------------------------

facts() {
  echo '### The lab'
  echo
  echo '| Fact | Value |'
  echo '| --- | --- |'
  local release
  # shellcheck source=/dev/null
  release="$(. /etc/os-release && echo "$PRETTY_NAME")"
  echo "| Host | ${release}, kernel $(uname -r), $(nproc) CPUs, $(free -g | awk '/^Mem:/ { print $2 }') GiB |"
  echo "| Runner image | ${ImageOS:-?} ${ImageVersion:-?} |"
  echo "| Incus | $(incus version 2>/dev/null | tr '\n' ' ') |"
  echo "| ZFS | $(modinfo -F version zfs 2>/dev/null || echo '?') |"
  echo "| Kernel features Incus reports | $(incus query /1.0 2>/dev/null | jq -c '.environment.kernel_features // {}' 2>/dev/null || echo '?') |"
  echo "| Pool | $POOL on a ${POOL_SIZE} sparse file, $(sudo zpool list -H -o name,size,alloc "$ZPOOL" 2>/dev/null | tr '\t' ' ') |"
  if [ -f "$dir/phases.tsv" ]; then
    echo
    echo '### Provisioning'
    echo
    echo '| Step | Seconds | Exit |'
    echo '| --- | ---: | ---: |'
    awk -F'\t' '{ printf "| %s | %s | %s |\n", $1, $2, $3 }' "$dir/phases.tsv"
  fi
}

diagnose() {
  mkdir -p "$dir/logs"
  section() { printf '\n== %s\n' "$*"; }
  {
    section date
    date -u
    section uname
    uname -a
    section df
    df -h
    section memory
    free -m
    section 'incus list (all projects)'
    incus list --all-projects -c ns4tS || true
    section 'incus images (all projects)'
    incus image list --all-projects || true
    section 'incus volumes'
    incus storage volume list "$POOL" --all-projects || true
    section 'incus networks'
    incus network list || true
    incus network show "$NETWORK" || true
    incus network acl show "$ACL" || true
    section 'incus project and profile'
    incus project show "$PROJECT" || true
    incus profile show "$PROFILE" --project "$PROJECT" || true
    section 'the egress proxy'
    incus info "$EGRESS_INSTANCE" --show-log || true
    incus console "$EGRESS_INSTANCE" --show-log || true
    section 'incus daemon journal'
    sudo journalctl -u incus --no-pager -n 400 || true
    section zfs
    sudo zpool status || true
    sudo zfs list -o name,used,avail,refer,mountpoint || true
    section 'addresses and routes'
    ip -br addr || true
    ip route || true
    section nftables
    sudo nft list ruleset 2>&1 | head -n 600 || true
    section 'iptables FORWARD'
    sudo iptables -S FORWARD 2>&1 | head -n 40 || true
    section docker
    docker ps -a || true
    docker logs --tail 100 e2e-registry || true
  } >"$dir/logs/diagnose.txt" 2>&1 || true
  echo "diagnostics written to $dir/logs/diagnose.txt"
}

print_env() {
  printf 'INCUS_E2E_DIR=%s\n' "$dir"
  printf 'INCUS_E2E_LAB=%s\n' "$dir/lab.json"
  printf 'E2E_RUNTIME_IMAGE=%s\n' "$RUNTIME_IMAGE"
  printf 'E2E_RUNTIME_IMAGE_NEXT=%s\n' "$RUNTIME_IMAGE_NEXT"
  printf 'INCUS_E2E_NEXT_CONTEXT=%s\n' "$dir/next"
  printf 'E2E_EGRESS_IMAGE=%s\n' "$EGRESS_IMAGE"
}

# `suites <choice>`: which suites a run was asked for. The choice is checked
# here, so a misspelt name fails the run at once and not as a silent skip.
pick_suites() {
  local choice="${1//[[:space:]]/}" name suite known
  choice="${choice:-all}"
  if [ "$choice" != all ]; then
    local -a names
    IFS=, read -r -a names <<<"$choice"
    for name in "${names[@]}"; do
      if [ -z "$name" ]; then continue; fi
      known=false
      for suite in "${SUITES[@]}"; do
        if [ "$name" = "$suite" ]; then known=true; fi
      done
      if [ "$known" = false ]; then
        die "unknown suite '$name': choose from ${SUITES[*]}, or all"
      fi
    done
  fi
  for suite in "${SUITES[@]}"; do
    if [ "$choice" = all ] || [[ ",$choice," == *",$suite,"* ]]; then
      echo "$suite=true"
    else
      echo "$suite=false"
    fi
  done
}

main() {
  local command="${1:-}"
  case "$command" in
    env) print_env ;;
    suites) pick_suites "${2:-}" ;;
    install | storage | api | registry | operator | egress | events | next-context | lab-file | facts | diagnose)
      guard
      ensure_dir
      case "$command" in
        install) phase install install_incus ;;
        storage) phase storage init_storage ;;
        api) phase api serve_api ;;
        registry) phase registry start_registry ;;
        operator) phase operator operator_setup ;;
        egress) phase egress start_egress ;;
        events) record_events ;;
        next-context) next_context ;;
        lab-file) write_lab_file ;;
        facts) facts ;;
        diagnose) diagnose ;;
      esac
      ;;
    *) die "usage: lab.sh install|storage|api|registry|operator|egress|events|next-context|lab-file|facts|diagnose|env|suites" ;;
  esac
}

main "$@"
