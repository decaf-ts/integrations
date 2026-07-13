# Custom Kibana image with the org_dashboard_embed plugin installed.
#
# The plugin source is copied into the image and installed via
# bin/kibana-plugin install, which runs Kibana's optimizer to build the
# TypeScript/JSX plugin source.
#
FROM docker.elastic.co/kibana/kibana:8.14.3

# Copy the plugin zip
COPY org_dashboard_embed.zip /tmp/org_dashboard_embed.zip

# Install the plugin
RUN bin/kibana-plugin install file:///tmp/org_dashboard_embed.zip

# Clean up
RUN rm /tmp/org_dashboard_embed.zip

# Kibana runs as uid 1000
USER 1000
