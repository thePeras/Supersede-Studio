#! /bin/bash

set -euxo pipefail

# Specs under apps/studio/tests/vitest/ run under vitest instead of jest (see
# apps/studio/tests/VITEST_MIGRATION.md).
SPEC="${1:-}"
SPEC_REL="${SPEC#apps/studio/}"
if [[ "$SPEC_REL" == tests/vitest/* ]]; then
  exec yarn workspace supersede-studio vitest:integration "$SPEC_REL"
fi

export ELECTRON_RUN_AS_NODE=1
export TEST_MODE=1

yarn workspace supersede-studio internal:integration "$@"
