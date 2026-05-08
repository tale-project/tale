#!/bin/sh
set -e

# Use exec so signals propagate to the Bun process and tini can shut us down cleanly.
exec bun server.js
