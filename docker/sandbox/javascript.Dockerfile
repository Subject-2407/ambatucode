# JavaScript (Node 22) sandbox.
#
# Built locally and never pulled at execution time — the platform has to run
# fully offline, and the worker resolves this image by tag and fails loudly if
# it is missing rather than reaching for a registry.
#
# Build context is the repository root:
#   docker compose -f docker/compose/sandbox.yml build
FROM node:22-bookworm-slim

# The job process runs as 65534:65534 with a read-only root filesystem, so
# every writable path it can reach is a tmpfs the worker mounts.
#   HOME            — npm and Node's own diagnostics expect a writable home.
#   NODE_OPTIONS    — no experimental warnings on stderr; a Coder reading their
#                     own program's output should not have to filter ours out.
#   NO_UPDATE_NOTIFIER, NPM_CONFIG_UPDATE_NOTIFIER — the notifier would try the
#                     network on every run, and there is no network.
ENV HOME=/tmp \
    NODE_OPTIONS=--no-warnings \
    NO_UPDATE_NOTIFIER=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

COPY docker/sandbox/base/harden.sh /tmp/harden.sh
RUN sh /tmp/harden.sh && rm -f /tmp/harden.sh

WORKDIR /workspace
USER 65534:65534

# No ENTRYPOINT and no meaningful CMD. The worker supplies an explicit argument
# vector for every execution; participant source code is never interpolated
# into a shell string, so there is nothing here for a shell to re-parse.
CMD ["node", "--version"]

LABEL ambatucode.sandbox="1" \
      ambatucode.language="javascript"
