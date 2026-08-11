#!/usr/bin/env bash
# Decide whether a package version bump should cut a release, and what to call
# it. Pure function of its inputs: no git, no network. The calling workflow
# reads the versions and tag list and passes them in.
#
# Inputs (environment):
#   BRANCH        branch the push landed on, e.g. master or dev
#   NEW_VERSION   .version from pkg/pve/package.json at the pushed commit
#   OLD_VERSION   .version at the previous tip; empty if none
#   EXISTING_TAGS newline-separated tags that already exist
#
# Outputs (appended to $GITHUB_OUTPUT, or stdout when unset):
#   bumped=true|false
#   tag=v<x.y.z>[-dev]    only when bumped=true
#   prerelease=true|false only when bumped=true
set -euo pipefail

PKG=pkg/pve/package.json

out() { printf '%s\n' "$1" >> "${GITHUB_OUTPUT:-/dev/stdout}"; }
fail() { printf '::error file=%s::%s\n' "$PKG" "$1" >&2; exit 1; }

: "${BRANCH:?BRANCH is required}"
: "${NEW_VERSION:=}"
: "${OLD_VERSION:=}"
: "${EXISTING_TAGS:=}"

# jq prints "null" for a missing key rather than an empty string.
if [ "$NEW_VERSION" = "null" ]; then NEW_VERSION=""; fi
if [ "$OLD_VERSION" = "null" ]; then OLD_VERSION=""; fi

if [ -z "$NEW_VERSION" ]; then
  fail "version is missing"
fi

# Plain x.y.z only; the -dev suffix is added to the tag below.
if ! printf '%s' "$NEW_VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  fail "version '$NEW_VERSION' is not plain semver (x.y.z)"
fi

case "$BRANCH" in
  dev) TAG="v${NEW_VERSION}-dev"; PRERELEASE=true ;;
  *)   TAG="v${NEW_VERSION}";     PRERELEASE=false ;;
esac

if [ "$OLD_VERSION" = "$NEW_VERSION" ]; then
  echo "$PKG changed but version did not; nothing to release." >&2
  out "bumped=false"
  exit 0
fi

if [ -n "$OLD_VERSION" ]; then
  LOWEST="$(printf '%s\n%s\n' "$OLD_VERSION" "$NEW_VERSION" | sort -V | head -1)"
  if [ "$LOWEST" != "$OLD_VERSION" ]; then
    fail "version went backwards: $OLD_VERSION -> $NEW_VERSION"
  fi
fi

has_tag() { printf '%s\n' "$EXISTING_TAGS" | grep -Fxq "$1"; }

if has_tag "$TAG"; then
  fail "tag $TAG already exists; bump to a new version instead of reusing one"
fi

if [ "$PRERELEASE" = true ] && has_tag "v${NEW_VERSION}"; then
  fail "v${NEW_VERSION} is already released; bump to a new version for a dev prerelease"
fi

out "bumped=true"
out "tag=$TAG"
out "prerelease=$PRERELEASE"
