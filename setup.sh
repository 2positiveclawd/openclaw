#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=0

usage() {
  cat <<'USAGE'
Usage: setup.sh [--dry-run|-n]

Bootstrap OpenClaw local directories and config.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run|-n)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
OPENCLAW_HOME="${OPENCLAW_HOME:-"$HOME/.openclaw"}"

TEMPLATES_DIR="$REPO_DIR/templates"
AGENT_IDS_FILE="$TEMPLATES_DIR/agent-ids.txt"
OPENCLAW_TEMPLATE="$TEMPLATES_DIR/openclaw.json.template"
SECRETS_TEMPLATE="$TEMPLATES_DIR/secrets.env.template"
SOULS_DIR="$TEMPLATES_DIR/souls"
BIN_TEMPLATES_DIR="$TEMPLATES_DIR/bin"
SYSTEMD_TEMPLATE="$TEMPLATES_DIR/systemd/dev-tree.conf"

created_dirs=()
created_files=()
skipped_items=()
manual_steps=()

require_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "Missing required file: $path" >&2
    exit 1
  fi
}

create_dir() {
  local dir="$1"
  if [[ -d "$dir" ]]; then
    skipped_items+=("$dir/")
    return 0
  fi
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "DRY RUN: mkdir -p $dir"
  else
    mkdir -p "$dir"
  fi
  created_dirs+=("$dir/")
}

copy_file_if_missing() {
  local src="$1"
  local dest="$2"
  if [[ -e "$dest" ]]; then
    skipped_items+=("$dest")
    return 0
  fi
  if [[ ! -f "$src" ]]; then
    echo "Missing template file: $src" >&2
    exit 1
  fi
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "DRY RUN: cp -a $src $dest"
  else
    cp -a "$src" "$dest"
  fi
  created_files+=("$dest")
}

copy_dir_if_missing() {
  local src="$1"
  local dest="$2"
  if [[ -e "$dest" ]]; then
    skipped_items+=("$dest/")
    return 0
  fi
  if [[ ! -d "$src" ]]; then
    echo "Missing plugin directory: $src" >&2
    exit 1
  fi
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "DRY RUN: cp -a $src $dest"
  else
    cp -a "$src" "$dest"
  fi
  created_dirs+=("$dest/")
}

render_template_to_file() {
  local src="$1"
  local dest="$2"
  if [[ -e "$dest" ]]; then
    skipped_items+=("$dest")
    return 0
  fi
  if [[ ! -f "$src" ]]; then
    echo "Missing template file: $src" >&2
    exit 1
  fi
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "DRY RUN: render $src -> $dest"
  else
    python3 - <<PY
from pathlib import Path
src = Path("$src")
dest = Path("$dest")
text = src.read_text()
text = text.replace("__REPO_DIR__", "$REPO_DIR")
dest.write_text(text)
PY
  fi
  created_files+=("$dest")
}

require_file "$AGENT_IDS_FILE"
require_file "$OPENCLAW_TEMPLATE"
require_file "$SECRETS_TEMPLATE"
require_file "$SYSTEMD_TEMPLATE"

create_dir "$OPENCLAW_HOME"
create_dir "$OPENCLAW_HOME/agents"
create_dir "$OPENCLAW_HOME/goal-loop"
create_dir "$OPENCLAW_HOME/planner"
create_dir "$OPENCLAW_HOME/researcher"
create_dir "$OPENCLAW_HOME/scout-proposals"
create_dir "$OPENCLAW_HOME/prds"
create_dir "$OPENCLAW_HOME/browser"
create_dir "$OPENCLAW_HOME/media"
create_dir "$OPENCLAW_HOME/dashboard"
create_dir "$OPENCLAW_HOME/extensions"

agent_ids=()
while IFS= read -r agent_id; do
  [[ -z "$agent_id" ]] && continue
  agent_ids+=("$agent_id")
  create_dir "$OPENCLAW_HOME/agents/$agent_id/sessions"
  if [[ "$agent_id" == "main" ]]; then
    create_dir "$OPENCLAW_HOME/workspace"
  else
    create_dir "$OPENCLAW_HOME/workspace-$agent_id"
  fi
done < "$AGENT_IDS_FILE"

copy_file_if_missing "$SECRETS_TEMPLATE" "$OPENCLAW_HOME/.secrets.env"
if [[ -f "$OPENCLAW_HOME/.secrets.env" ]]; then
  chmod 600 "$OPENCLAW_HOME/.secrets.env"
fi
copy_file_if_missing "$OPENCLAW_TEMPLATE" "$OPENCLAW_HOME/openclaw.json"

if [[ -d "$SOULS_DIR" ]]; then
  for agent_id in "${agent_ids[@]}"; do
    if [[ "$agent_id" == "main" ]]; then
      copy_file_if_missing "$SOULS_DIR/main.md" "$OPENCLAW_HOME/workspace/SOUL.md"
    else
      copy_file_if_missing "$SOULS_DIR/$agent_id.md" "$OPENCLAW_HOME/workspace-$agent_id/SOUL.md"
    fi
  done
else
  echo "Missing souls directory: $SOULS_DIR" >&2
  exit 1
fi

SKILLS_DIR="$TEMPLATES_DIR/skills"
if [[ -d "$SKILLS_DIR" ]]; then
  shopt -s nullglob
  for plugin_dir in "$SKILLS_DIR"/*; do
    [[ -d "$plugin_dir" ]] || continue
    plugin_name="$(basename "$plugin_dir")"
    copy_dir_if_missing "$plugin_dir" "$OPENCLAW_HOME/extensions/$plugin_name"
  done
  shopt -u nullglob
else
  echo "Missing skills directory: $SKILLS_DIR" >&2
  exit 1
fi

systemd_dest="$HOME/.config/systemd/user/openclaw-gateway.service.d/dev-tree.conf"
create_dir "$(dirname "$systemd_dest")"
if [[ ! -e "$systemd_dest" ]]; then
  render_template_to_file "$SYSTEMD_TEMPLATE" "$systemd_dest"
  manual_steps+=("Run: systemctl --user daemon-reload && systemctl --user restart openclaw-gateway")
else
  skipped_items+=("$systemd_dest")
fi

wrappers_installed=0
if [[ -d "$BIN_TEMPLATES_DIR" ]]; then
  install_wrappers="no"
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "DRY RUN: skipping wrapper install prompt"
  else
    read -r -p "Install CLI wrappers to /usr/local/bin? (requires sudo) [y/N] " install_wrappers
  fi
  if [[ "$install_wrappers" =~ ^[Yy]$ ]]; then
    for wrapper in "$BIN_TEMPLATES_DIR"/*; do
      [[ -f "$wrapper" ]] || continue
      wrapper_name="$(basename "$wrapper")"
      dest="/usr/local/bin/$wrapper_name"
      if [[ -e "$dest" ]]; then
        skipped_items+=("$dest")
        continue
      fi
      if [[ $DRY_RUN -eq 1 ]]; then
        echo "DRY RUN: sudo install -m 0755 $wrapper $dest"
      else
        tmp_file="$(mktemp)"
        python3 - <<PY
from pathlib import Path
src = Path("$wrapper")
text = src.read_text().replace("__REPO_DIR__", "$REPO_DIR")
Path("$tmp_file").write_text(text)
PY
        sudo install -m 0755 "$tmp_file" "$dest"
        rm -f "$tmp_file"
      fi
      created_files+=("$dest")
      wrappers_installed=1
    done
  else
    manual_steps+=("Install CLI wrappers from $BIN_TEMPLATES_DIR to /usr/local/bin (requires sudo)")
  fi
fi

if [[ "${created_files[*]}" == *"$OPENCLAW_HOME/.secrets.env"* ]]; then
  manual_steps+=("Fill in secrets: $OPENCLAW_HOME/.secrets.env")
fi
if [[ "${created_files[*]}" == *"$OPENCLAW_HOME/openclaw.json"* ]]; then
  manual_steps+=("Review config: $OPENCLAW_HOME/openclaw.json")
fi

if [[ $DRY_RUN -eq 1 ]]; then
  echo ""
  echo "DRY RUN: no changes were made."
fi

echo ""
echo "Summary"
echo "-------"
echo "Created directories: ${#created_dirs[@]}"
if [[ ${#created_files[@]} -gt 0 ]]; then
  echo "Created files:"
  for item in "${created_files[@]}"; do
    echo "  - $item"
  done
else
  echo "Created files: (none)"
fi

if [[ ${#skipped_items[@]} -gt 0 ]]; then
  echo "Skipped existing:"
  for item in "${skipped_items[@]}"; do
    echo "  - $item"
  done
else
  echo "Skipped existing: (none)"
fi

if [[ ${#manual_steps[@]} -gt 0 ]]; then
  echo "Manual steps:"
  for item in "${manual_steps[@]}"; do
    echo "  - $item"
  done
else
  echo "Manual steps: (none)"
fi
