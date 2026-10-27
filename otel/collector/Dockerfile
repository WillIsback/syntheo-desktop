FROM otel/opentelemetry-collector-contrib:0.139.0

COPY otel/collector/config.yaml /etc/otelcol-contrib/config.yaml

# The official image already runs as uid/gid 10001; make it explicit so the
# container never falls back to root if the base image changes.
USER 10001:10001

CMD ["--config", "/etc/otelcol-contrib/config.yaml"]
