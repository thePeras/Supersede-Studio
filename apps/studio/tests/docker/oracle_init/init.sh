#!/bin/bash

set -euxo pipefail

echo "Starting to run scripts..."
sqlplus -s supersede/password@//localhost/SUPERSEDE @"/docker-entrypoint-initdb.d/scripts/1.sql"

echo "Finished running scripts"
