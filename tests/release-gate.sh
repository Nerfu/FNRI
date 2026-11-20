#!/usr/bin/env bash
# One source of truth for local pre-release tests and GitHub Actions.
set -euo pipefail
cd "$(dirname "$0")/.."

while IFS= read -r -d '' file; do
  node --check "$file"
done < <(find . -name '*.mjs' -not -path './node_modules/*' -print0)

for test_file in tests/*.mjs; do
  node "$test_file"
done
python3 tests/contract_check.py
