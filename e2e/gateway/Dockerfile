# The gateway image for the acceptance run only (`spec/ai-gateway.md` §10).
#
# It is the deployed container minus the host networking, the WireGuard tunnel and the
# persistent volume: the same `node apps/ai-gateway/server.mjs` entry, the same plain ESM,
# a read-only root and a tmpfs state directory. `@remo/outbound` is a workspace package,
# so the two paths are copied and the link pnpm would create is made here instead.
FROM node:22-bookworm-slim

WORKDIR /srv/remo

COPY packages/outbound ./packages/outbound
COPY apps/ai-gateway ./apps/ai-gateway

RUN mkdir -p apps/ai-gateway/node_modules/@remo \
    && ln -s ../../../../packages/outbound apps/ai-gateway/node_modules/@remo/outbound

USER node

CMD ["node", "apps/ai-gateway/server.mjs"]
