#!/bin/sh
# Shared hardening layer for every Ambatucode sandbox image.
#
# This is a script rather than a base image on purpose. Each language must
# start from its own official runtime to get the exact version the platform
# promises — Debian bookworm ships Python 3.11, so a shared Debian base image
# could not produce the required Python 3.12. Every language Dockerfile copies
# this script and runs it as its last build step, so the hardening is identical
# across images while the runtime underneath is not.
#
# These measures are defence in depth. The container already runs with no
# network, no capabilities, a read-only root, and a non-root user; what follows
# shrinks what is reachable if one of those ever fails.
set -eu

# Strip setuid/setgid bits everywhere. Nothing in a sandbox has any reason to
# escalate, and a forgotten setuid binary is the cheapest privilege-escalation
# primitive an attacker can hope for.
find / -xdev -type f -perm /6000 -exec chmod a-s {} + 2>/dev/null || true

# Drop the build-time package tooling that runtime images ship. Network is
# already off so none of it can fetch anything; removing it shrinks the
# post-exploitation toolbox rather than preventing installs.
rm -rf \
  /usr/bin/apt /usr/bin/apt-get /usr/bin/apt-cache /usr/bin/apt-config \
  /usr/bin/apt-key /usr/bin/apt-mark /usr/bin/dpkg /usr/bin/dpkg-deb \
  /usr/bin/dpkg-query /usr/bin/dpkg-split /usr/bin/dpkg-trigger \
  /var/lib/apt /var/cache/apt /var/cache/debconf \
  /usr/local/bin/pip /usr/local/bin/pip3 \
  2>/dev/null || true

# Deny the unprivileged runtime user any view of the account database beyond
# what name resolution needs. /etc/shadow is a threat case we test explicitly.
chmod 0600 /etc/shadow 2>/dev/null || true

# Mountpoint for the writable scratch tmpfs the worker mounts at run time. It
# only has to exist here; the mount options set its real ownership and mode,
# because a read-only root filesystem makes the image's own copy unwritable.
mkdir -p /workspace
chmod 0555 /workspace

# Base image contract. Every sandbox image must keep these two on PATH:
#
#   sleep — the container's own process, which outlives the job's wall clock so
#           the worker's deadline is always the one that fires.
#   tee   — receives the job's source on an exec's stdin and writes it into the
#           scratch mount. Docker refuses to copy into a container with a
#           read-only root filesystem, and that read-only root is not
#           negotiable, so this is how a workspace gets in without ever
#           bind-mounting a host path.
#
# Removing coreutils from a language image will break execution, not harden it.
for required in sleep tee; do
  command -v "$required" > /dev/null || {
    echo "sandbox image is missing required binary: $required" >&2
    exit 1
  }
done
