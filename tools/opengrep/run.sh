#!/usr/bin/env bash
# Pinned Opengrep (Semgrep CE fork) runner — the single entry point for local
# dev, pre-commit, and CI, so every environment runs the exact same engine and
# rules. Downloads the pinned release binary once and caches it per version.
#
# Usage:
#   tools/opengrep/run.sh                 # strict scan of the whole repo (the gate)
#   tools/opengrep/run.sh path/a path/b   # scan specific paths (pre-commit passes staged files)
set -euo pipefail

# The bundled Python wrapper reads configs and source files with the locale's
# default codec; force UTF-8 so non-ASCII bytes (em dashes, accented i18n
# strings) don't crash the scan on a minimal CI locale.
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8

# Keep in lockstep with the version Renovate is told to leave alone, and with
# the CI cache key in .github/workflows/security.yml.
OPENGREP_VERSION="v1.22.0"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cache_dir="${OPENGREP_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/opengrep}"
bin="${cache_dir}/${OPENGREP_VERSION}/opengrep"

detect_asset() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "${os}_${arch}" in
    Darwin_arm64) echo "opengrep_osx_arm64" ;;
    Darwin_x86_64) echo "opengrep_osx_x86" ;;
    Linux_x86_64 | Linux_amd64) echo "opengrep_manylinux_x86" ;;
    Linux_aarch64 | Linux_arm64) echo "opengrep_manylinux_aarch64" ;;
    *) echo "unsupported:${os}_${arch}" ;;
  esac
}

ensure_binary() {
  if [ -x "${bin}" ]; then return; fi
  # Pre-commit sets this so a missing binary (offline / first run) skips the hook
  # rather than blocking the commit on a download. CI is the enforcing gate.
  if [ -n "${OPENGREP_SKIP_IF_UNCACHED:-}" ]; then
    echo "opengrep: ${OPENGREP_VERSION} not cached; skipping. Run 'bun run lint:sast' once to enable the pre-commit scan." >&2
    exit 0
  fi
  local asset url
  asset="$(detect_asset)"
  if [[ "${asset}" == unsupported:* ]]; then
    echo "opengrep: unsupported platform ${asset#unsupported:}" >&2
    echo "opengrep: install manually from https://github.com/opengrep/opengrep/releases/tag/${OPENGREP_VERSION}" >&2
    exit 1
  fi
  url="https://github.com/opengrep/opengrep/releases/download/${OPENGREP_VERSION}/${asset}"
  echo "opengrep: downloading ${OPENGREP_VERSION} (${asset})…" >&2
  mkdir -p "$(dirname "${bin}")"
  curl -fsSL "${url}" -o "${bin}.tmp"
  chmod +x "${bin}.tmp"
  mv "${bin}.tmp" "${bin}"
}

ensure_binary

# No paths given → scan the repo root (the full gate). Paths given (pre-commit)
# → scan just those.
targets=("$@")
if [ "${#targets[@]}" -eq 0 ]; then
  targets=("${repo_root}")
fi

# Build --exclude globs from .opengrepignore (gitignore syntax). Opengrep honors
# .gitignore by default, so this only adds committed-but-skip paths (generated
# code, templates, fixtures). One readable source for the exclusions.
exclude_args=()
ignore_file="${repo_root}/.opengrepignore"
if [ -f "${ignore_file}" ]; then
  while IFS= read -r line || [ -n "${line}" ]; do
    case "${line}" in
      '' | \#*) continue ;;
    esac
    exclude_args+=("--exclude=${line}")
  done <"${ignore_file}"
fi

# Optional SARIF output for the GitHub Security tab (CI sets this).
sarif_args=()
if [ -n "${OPENGREP_SARIF_OUTPUT:-}" ]; then
  sarif_args+=("--sarif-output=${OPENGREP_SARIF_OUTPUT}")
fi

# Rule set. The vendored custom rules in config.yml always run (deterministic,
# zero-network, fast). The broad registry packs add OWASP / CWE / language /
# secrets coverage) from a pinned vendored snapshot, no network. Pre-commit
# sets OPENGREP_LOCAL_ONLY=1 to run only the fast local rules (no network) — the
# full pack set is the CI gate.
config_args=("--config" "${repo_root}/tools/opengrep/config.yml")
if [ -z "${OPENGREP_LOCAL_ONLY:-}" ]; then
  config_args+=("--config" "${repo_root}/tools/opengrep/rules/registry-pinned.yml")
fi

# Per-rule suppressions for systematically-false-positive pack rules live in
# .opengrep-exclude-rules (one rule id per line); fixing or suppressing each
# finding inline is preferred, this is for rules that only ever fire as noise
# in this codebase (documented there).
exclude_rule_args=()
exclude_rules_file="${repo_root}/tools/opengrep/excluded-rules.txt"
if [ -f "${exclude_rules_file}" ]; then
  while IFS= read -r line || [ -n "${line}" ]; do
    case "${line}" in
      '' | \#*) continue ;;
    esac
    exclude_rule_args+=("--exclude-rule=${line}")
  done <"${exclude_rules_file}"
fi

# --error: any reported finding exits non-zero (the blocking gate). Gate on
# ERROR and WARNING (the strictness level chosen for this repo); INFO rules are
# dropped from the run so they neither block nor add noise.
# Bash 3.2 (macOS /bin/bash) treats "${empty[@]}" as unbound under `set -u`.
scan_args=(
  "${config_args[@]}"
  --severity=ERROR
  --severity=WARNING
  --error
  --disable-version-check
)
if [ "${#sarif_args[@]}" -gt 0 ]; then
  scan_args+=("${sarif_args[@]}")
fi
if [ "${#exclude_rule_args[@]}" -gt 0 ]; then
  scan_args+=("${exclude_rule_args[@]}")
fi
if [ "${#exclude_args[@]}" -gt 0 ]; then
  scan_args+=("${exclude_args[@]}")
fi
scan_args+=("${targets[@]}")
exec "${bin}" scan "${scan_args[@]}"
