# C++20 sandbox, built on the GCC toolchain.
#
# Built locally and never pulled at execution time — the platform has to run
# fully offline, and the worker resolves this image by tag and fails loudly if
# it is missing rather than reaching for a registry.
#
# Build context is the repository root:
#   docker compose -f docker/compose/sandbox.yml build
#
# The full `gcc` image would be several gigabytes for a compiler this only ever
# invokes one way, so g++ is installed onto a slim Debian instead. Bookworm
# ships GCC 12, which implements the parts of C++20 a teaching context uses.
FROM debian:bookworm-slim

# `--no-install-recommends` keeps out documentation, an editor, and a mail
# transport agent that would otherwise arrive as recommended packages. The
# apt lists are removed in the same layer so they never reach the image.
RUN apt-get update \
    && apt-get install --no-install-recommends -y g++ libstdc++-12-dev \
    && rm -rf /var/lib/apt/lists/*

# The job process runs as 65534:65534 with a read-only root filesystem, so
# every writable path it can reach is a tmpfs the worker mounts. GCC writes its
# temporary objects under TMPDIR, which has to be one of them.
ENV HOME=/tmp \
    TMPDIR=/tmp

COPY docker/sandbox/base/harden.sh /tmp/harden.sh
RUN sh /tmp/harden.sh && rm -f /tmp/harden.sh

WORKDIR /workspace
USER 65534:65534

# No ENTRYPOINT and no meaningful CMD. The worker supplies an explicit argument
# vector for every execution; participant source code is never interpolated
# into a shell string, so there is nothing here for a shell to re-parse.
CMD ["g++", "--version"]

LABEL ambatucode.sandbox="1" \
      ambatucode.language="cpp"
