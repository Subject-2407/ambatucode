# JavaScript (Node 22) sandbox.
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

# npm is needed to install Jest and for nothing after. Deleting it in a later
# layer would not shrink the image — it would still sit in the base layer — so
# Jest is installed here and only the runtime and Jest are carried forward.
FROM node:22.23.2-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS jest

# The test framework for Architect-authored Jest scripts, pinned and baked in:
# there is no network at execution time to install it then.
RUN npm install --global --no-fund --no-audit jest@30.5.1

# The same Debian release the Node binary was built for, and the same base as
# the C++ and Java images, so the three share a layer.
FROM debian:12.15-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171

# The job process runs as 65534:65534 with a read-only root filesystem, so
# every writable path it can reach is a tmpfs the worker mounts.
#   HOME            — Node's own diagnostics expect a writable home.
#   NODE_OPTIONS    — no experimental warnings on stderr; a Coder reading their
#                     own program's output should not have to filter ours out.
ENV HOME=/tmp \
    NODE_OPTIONS=--no-warnings

COPY --from=jest /usr/local/bin/node /usr/local/bin/node
COPY --from=jest /usr/local/lib/node_modules/jest /usr/local/lib/node_modules/jest
RUN ln -s ../lib/node_modules/jest/bin/jest.js /usr/local/bin/jest

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
