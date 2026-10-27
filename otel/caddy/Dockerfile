FROM caddy:2.11.1-alpine

# Render does not permit executing the Caddy binary with bundled file capabilities.
# We do not need those optional capabilities for this OTEL ingest edge.
RUN setcap -r /usr/bin/caddy

COPY otel/caddy/Caddyfile /etc/caddy/Caddyfile

# Run the edge as an unprivileged user. The base image leaves /config and
# /data writable for non-root processes; this edge only proxies to the collector.
RUN addgroup -S caddy && adduser -S -G caddy -H caddy
USER caddy
