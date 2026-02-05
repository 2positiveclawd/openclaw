#!/usr/bin/env bash
set -u -o pipefail

REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATES_DIR="$REPO_DIR/templates"
AGENT_IDS_FILE="$TEMPLATES_DIR/agent-ids.txt"
SOULS_DIR="$TEMPLATES_DIR/souls"

usage() {
  cat <<'USAGE'
Usage: OPENCLAW_HOME=... bash scripts/verify-setup-tree.sh
USAGE
}

if [[ -z "${OPENCLAW_HOME:-}" ]]; then
  echo "ERROR: OPENCLAW_HOME is not set." >&2
  usage >&2
  exit 1
fi

if [[ ! -d "$OPENCLAW_HOME" ]]; then
  echo "ERROR: OPENCLAW_HOME directory not found: $OPENCLAW_HOME" >&2
  exit 1
fi

errors=0

say_err() {
  echo "ERROR: $*" >&2
  errors=$((errors + 1))
}

if [[ ! -f "$AGENT_IDS_FILE" ]]; then
  say_err "Missing agent ids file: $AGENT_IDS_FILE"
fi

if [[ ! -d "$SOULS_DIR" ]]; then
  say_err "Missing souls directory: $SOULS_DIR"
else
  souls_count=$(find "$SOULS_DIR" -maxdepth 1 -type f | wc -l | tr -d ' ')
  if [[ "$souls_count" -ne 24 ]]; then
    say_err "Expected 24 files in $SOULS_DIR, found $souls_count"
  fi
fi

required_dirs=(
  agents
  goal-loop
  planner
  researcher
  scout-proposals
  prds
  browser
  media
  dashboard
  extensions
)

for dir in "${required_dirs[@]}"; do
  if [[ ! -d "$OPENCLAW_HOME/$dir" ]]; then
    say_err "Missing directory: $OPENCLAW_HOME/$dir"
  fi
done

if [[ -f "$AGENT_IDS_FILE" ]]; then
  while IFS= read -r agent_id; do
    [[ -z "$agent_id" ]] && continue
    [[ "$agent_id" == \#* ]] && continue

    sessions_dir="$OPENCLAW_HOME/agents/$agent_id/sessions"
    if [[ ! -d "$sessions_dir" ]]; then
      say_err "Missing sessions directory: $sessions_dir"
    fi

    if [[ "$agent_id" == "main" ]]; then
      workspace_dir="$OPENCLAW_HOME/workspace"
    else
      workspace_dir="$OPENCLAW_HOME/workspace-$agent_id"
    fi

    if [[ ! -d "$workspace_dir" ]]; then
      say_err "Missing workspace directory: $workspace_dir"
    fi
  done < "$AGENT_IDS_FILE"
fi

if [[ "$errors" -ne 0 ]]; then
  exit 1
fi

echo "OK: OpenClaw setup tree looks valid for $OPENCLAW_HOME"
