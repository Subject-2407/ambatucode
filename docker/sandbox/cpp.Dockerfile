# C++20 sandbox, built on the GCC toolchain.
#
# Built locally and never pulled at execution time — the platform has to run
# fully offline, and the worker resolves this image by tag and fails loudly if
# it is missing rather than reaching for a registry.
#
# Build context is the repository root:
#   docker compose -f docker/compose/sandbox.yml build
#
# Every base image is pinned by digest. The tag beside it is for humans; the
# digest is what gets built, so a lab image is exactly the one that was tested.
#
# The full `gcc` image would be several gigabytes for a compiler this only ever
# invokes one way, so g++ is installed onto a slim Debian instead. Bookworm
# ships GCC 12, which implements the parts of C++20 a teaching context uses.
FROM debian:12.15-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171

# `--no-install-recommends` keeps out documentation, an editor, and a mail
# transport agent that would otherwise arrive as recommended packages.
#
# libgtest-dev is GoogleTest for Architect test scripts. Bookworm's package
# ships the headers and prebuilt static libgtest and libgtest_main, so a script
# links against them with no build step and no network.
#
# The removals happen in this same layer, or they would shrink nothing. They
# take out what the worker's fixed g++ invocations never reach: the C compiler
# (cc1), link-time optimisation (lto1, lto-dump — no -flto is ever passed),
# the sanitizer runtimes (no -fsanitize), and documentation other than the
# copyright files the licences require to travel with the binaries. The LTO
# linker plugin stays: g++ hands it to the linker on every link.
RUN apt-get update \
    && apt-get install --no-install-recommends -y g++ libstdc++-12-dev libgtest-dev \
    && rm -rf /var/lib/apt/lists/* \
    && libexec="$(dirname "$(g++ -print-prog-name=cc1plus)")" \
    && rm -f "$libexec/cc1" "$libexec/lto1" /usr/bin/*lto-dump* \
    && find /usr/lib -name 'lib*san.so*' -delete \
    && find /usr/lib/gcc -name 'lib*san*.a' -delete \
    && find /usr/share/doc -type f ! -name copyright -delete \
    && rm -rf /usr/share/man /usr/share/info /usr/share/locale

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
