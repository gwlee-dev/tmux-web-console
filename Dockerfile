# CI image for tmux-web-console: Ubuntu/Debian-based Playwright runner that
# carries all native build deps for node-pty, the tmux binary, the Pretendard
# and Monoplex KR Nerd system fonts, and the Playwright Chromium browser.
#
# Purpose:
#   * Produce deterministic chromium-linux Playwright goldens for the visual
#     regression suite (bootstrapped from a macOS dev machine before CI exists).
#   * Mirror the GitHub Actions workflow environment 1:1 for local debugging.

FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

# Locale note:
#   The `node:20-bookworm-slim` base image defaults to LC_CTYPE=POSIX with no
#   LANG set. Under that locale, tmux's format engine silently rewrites
#   literal tab characters in `-F` format strings into underscores, which
#   silently corrupts `src/tmux.js`'s tab-delimited parseTable() rows (see
#   listSessions at src/tmux.js:127). Setting LANG/LC_ALL to C.UTF-8 above
#   keeps tmux emitting real tabs and matches the locale behaviour of the
#   GitHub Actions ubuntu-latest runner.
#
# System packages:
#   tmux                          -- runtime dependency of the app
#   python3, make, g++            -- required to build the node-pty native addon
#   fontconfig                    -- fc-cache / fc-list used by install-fonts.sh
#   curl, ca-certificates, unzip  -- used by the install-fonts.sh TTF fallback
#   locales                       -- provides /usr/lib/locale/C.utf8 so the
#                                    LANG/LC_ALL ENV above actually resolves
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       tmux \
       python3 \
       make \
       g++ \
       fontconfig \
       curl \
       ca-certificates \
       unzip \
       locales \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN corepack enable

# Install JS deps first for better layer caching.
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
RUN yarn install --immutable

# Copy the rest of the repo (node_modules/dist/etc. are excluded via
# .dockerignore so the yarn install layer above is preserved).
COPY . .

# Register Pretendard + Monoplex KR Nerd with fontconfig so that Chromium
# picks them up for the visual regression goldens.
RUN chmod +x scripts/install-fonts.sh && scripts/install-fonts.sh

# Produce the production Vite bundle. Playwright's webServer boots the
# Fastify server via `node src/server.js`, which in non-dev mode loads the
# pre-built bundle from dist/. Without this step the server exits with
# "Failed to load cached Vite configuration."
RUN yarn build

# Install the Playwright Chromium browser plus its apt dependencies.
RUN npx --yes playwright install --with-deps chromium

# Default command: run the Playwright chromium project. Override as needed
# (e.g. --update-snapshots for golden regeneration).
CMD ["yarn", "test:e2e", "--project=chromium"]
