# OpenClaw Bootstrap (setup.sh)

Tiny README for the bootstrap flow: what it does, what it never does, and what you still need to do by hand.

## Quickstart

```bash
./setup.sh
```

## Testing (dry run)

```bash
OPENCLAW_HOME=/tmp/openclaw-test-setup bash setup.sh --dry-run
```

## What `setup.sh` does

- Creates the OpenClaw home directory structure (default: `~/.openclaw`, or `OPENCLAW_HOME`).
- Creates per-agent workspace directories and session folders.
- Copies template files **only if missing**:
  - `openclaw.json` and `.secrets.env`
  - agent `SOUL.md` files
  - extension bundles from `./skills` into `~/.openclaw/extensions`
- Renders a user-level systemd override (`dev-tree.conf`) if missing.
- Offers an **interactive prompt** to install CLI wrappers to `/usr/local/bin` (requires sudo).
- Prints a summary of created items, skipped items, and manual steps.

## What it never does (non-goals / safety)

- **Never overwrites** existing config, secrets, or soul files.
- **Never restarts** the OpenClaw gateway or any system service.
- **Never performs global installs** or `sudo` actions **without asking**.
- **Never deletes** files or directories.

## Manual steps checklist

- [ ] Fill in secrets: `~/.openclaw/.secrets.env` (or `$OPENCLAW_HOME/.secrets.env`).
- [ ] Review/confirm config: `~/.openclaw/openclaw.json` (or `$OPENCLAW_HOME/openclaw.json`).
- [ ] If the systemd override was created and you want it active:
  - `systemctl --user daemon-reload`
  - `systemctl --user restart openclaw-gateway`
- [ ] If you skipped wrapper install, manually install wrappers from `templates/bin` to `/usr/local/bin` (requires sudo).
- [ ] Export `OPENCLAW_HOME` in your shell if you want a non-default location.

## Acceptance criteria (1–8)

1. `docs/fork/SETUP.md` exists and documents the bootstrap flow.
2. Quickstart shows `./setup.sh`.
3. Testing includes `OPENCLAW_HOME=/tmp/openclaw-test-setup bash setup.sh --dry-run`.
4. Describes what `setup.sh` does (dirs, templates, systemd override, wrappers prompt).
5. States non-goals: no overwrites, no gateway restarts, no global installs without asking.
6. Manual steps checklist includes secrets, config review, and optional systemd reload.
7. Mentions `OPENCLAW_HOME` override.
8. Notes the optional wrapper install/manual follow-up.
