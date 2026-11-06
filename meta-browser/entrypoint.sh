#!/bin/sh
set -eu
mkdir -p /data/meta-browser
chown node:node /data/meta-browser
exec gosu node "$@"
