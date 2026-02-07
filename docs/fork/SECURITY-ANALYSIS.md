# Security Analysis

> Comprehensive security posture assessment, vulnerabilities, and recommendations.

## Executive Summary

**Overall posture: Good foundational security with some significant gaps.**

OpenClaw demonstrates strong security fundamentals in authentication, SSRF protection, file system sandboxing, and input validation. The architecture properly separates concerns (gateway auth -> channel allowlists -> tool approvals). However, secrets management is weak (plaintext storage), audit logging is insufficient for forensics, and configuration requires active hardening -- the defaults are not fully secure out of the box.

**Suitable for**: Trusted single-user or small-team deployments.
**Requires hardening for**: Multi-user or public-facing deployments.

---

## Current Security Posture

| Layer           | Setting                            | Status               |
| --------------- | ---------------------------------- | -------------------- |
| Gateway binding | `loopback` (127.0.0.1)             | Secure -- local only |
| Gateway auth    | Token required                     | Active               |
| Discord policy  | `allowlist`                        | Restricted           |
| Browser sandbox | `noSandbox: false`                 | Enabled              |
| DM policy       | `allowlist` (single user)          | Restricted           |
| Secrets file    | Separate `.secrets.env`, 600 perms | Isolated             |

---

## 1. Authentication and Gateway Security

### Strengths

- **Timing-safe token comparison** (`timingSafeEqual`) prevents timing attacks
- **Loopback binding** (127.0.0.1:18789) prevents network exposure by default
- **Multiple auth modes**: Token, password, Tailscale identity verification
- **Trusted proxy support**: Rejects spoofed `X-Forwarded-For` from untrusted sources
- **Local-direct detection**: Validates that connections claiming to be local actually are

### Vulnerabilities

- **Token in systemd config**: The gateway token is visible in plaintext in the systemd service file (`~/.config/systemd/user/openclaw-gateway.service`). If the user's home directory is accessible to other processes, the token is exposed.
- **No token rotation**: Long-lived static tokens with no built-in rotation mechanism.
- **No multi-factor auth**: Single-factor token or password only.

### Recommendations

1. Store tokens exclusively in `.secrets.env` (mode 600), reference via `EnvironmentFile=` in systemd
2. Implement periodic token rotation reminders
3. Consider Tailscale identity as secondary factor for remote access

---

## 2. Shell Execution (exec tool)

### Strengths

- **Exec safety validation** (`src/infra/exec-safety.ts`): Blocks dangerous shell metacharacters (`;`, `&`, `|`, `` ` ``, `$`, `<`, `>`, control characters, quotes)
- **Approval system** (`src/infra/exec-approvals.ts`): Time-limited approvals with allow-once/allow-always/deny, forwarding to Discord for human review
- **Session-level filtering**: Approvals scoped to specific agent sessions

### Vulnerabilities

- **Argument injection**: Validates executable name but not full command arguments. A safe executable name could still receive malicious arguments.
- **No working directory sandboxing**: Exec commands run in the agent's workspace but aren't chrooted. Path traversal in arguments could access files outside the workspace.
- **Tool approval routing**: If an agent can influence the `sessionKey` field, it might route approvals to unintended channels.

### Recommendations

1. Extend validation to include argument sanitization
2. Consider chroot or namespace isolation for exec commands
3. Validate approval routing keys server-side

---

## 3. File System Access

### Strengths

- **Safe file opening** (`src/infra/fs-safe.ts`):
  - Resolves root directory to real path (prevents symlink escapes)
  - Verifies resolved paths stay within root (`startsWith(rootWithSep)`)
  - Uses `O_NOFOLLOW` to prevent symlink following on Unix
  - Double-checks inode/device to prevent TOCTOU attacks
  - Opens files read-only (`O_RDONLY`)
- **Workspace isolation**: Each agent has a dedicated workspace directory

### Vulnerabilities

- **Write operations not sandboxed**: `openFileWithinRoot()` is read-only; write operations may not have equivalent protection
- **Credential files unencrypted**: WhatsApp creds, OAuth tokens, and model auth profiles stored as plaintext JSON

### Recommendations

1. Apply equivalent path validation to write operations
2. Implement encryption at rest for credential files
3. Consider OS-level MAC (AppArmor/SELinux) profiles per agent

---

## 4. SSRF Protection

### Strengths

- **Comprehensive SSRF blocking** (`src/infra/net/ssrf.ts`):
  - Blocks all private IP ranges (10/8, 172.16/12, 192.168/16, 169.254/16, 127/8)
  - Blocks private IPv6 (fe80::, fc/7, fd/8)
  - Blocks metadata endpoints (`metadata.google.internal`, `.localhost`, `.local`, `.internal`)
  - DNS pinning prevents rebinding attacks
  - Explicit hostname allowlists

### Vulnerabilities

- **Not default-strict**: Requires explicit `allowPrivateNetwork: false` configuration
- **Application-level only**: Not enforced at the gateway boundary for all requests

### Recommendations

1. Make `allowPrivateNetwork: false` the default
2. Consider network-level egress filtering (iptables/nftables) as defense-in-depth

---

## 5. Prompt Injection Protection

### Strengths

- **External content wrapping** (`src/security/external-content.ts`):
  - Detects suspicious patterns: "ignore instructions", "system:", "delete all", `rm -rf`
  - Wraps untrusted content in `<<<EXTERNAL_UNTRUSTED_CONTENT>>>` markers
  - Handles Unicode tricks (full-width characters)
  - Sanitizes marker injection attempts

### Vulnerabilities

- **Detection without enforcement**: Suspicious patterns are logged but content is still processed. The system relies on the model respecting markers.
- **No content sandboxing**: External content (emails, webhooks, web fetches) goes to the same model context as trusted instructions.
- **Evolving attack surface**: New prompt injection techniques may bypass pattern matching.

### Recommendations

1. Consider a two-model architecture: screening model evaluates external content before it reaches the main agent
2. Implement hard blocks for known dangerous patterns in tool arguments (e.g., `rm -rf /`)
3. Regular review of pattern detection against new injection techniques

---

## 6. Discord Bot Security

### Strengths

- **Multi-level allowlists**: Guild-level, channel-level, and user-level
- **Per-channel mention requirements**: Can require @bot mention in specific channels
- **Normalized matching**: Case-insensitive slug matching for usernames
- **Command authorization**: Commands only accepted from authorized senders

### Vulnerabilities

- **No rate limiting**: No visible per-user or per-channel message rate limits. A compromised or malicious allowlisted user could flood the bot.
- **Slug normalization collisions**: Different usernames could theoretically normalize to the same slug.
- **Open group policy footgun**: `groupPolicy="open"` accepts messages from anyone if set.

### Recommendations

1. Implement per-user rate limiting (e.g., 10 messages/minute)
2. Add per-channel cooldown periods
3. Alert on unusual message volume from any single user

---

## 7. Plugin and Extension Security

### Strengths

- **Dedicated extension bridge**: Clean separation between upstream and fork code
- **Config schema validation**: Plugin configurations validated before initialization

### Vulnerabilities

- **No code signing**: Plugins installed from npm could be compromised. Only `npm pack` + `npm install --omit=dev` is used, and npm lifecycle scripts execute during install.
- **Auto-discovery**: Plugins are auto-discovered from directories. No explicit allowlist enforcement by default.
- **Runtime code loading via jiti**: If plugin source files are writable by other processes, this could lead to code injection.
- **In-process execution**: Plugins run in the same Node.js process as the gateway. A malicious plugin has full access.

### Recommendations

1. Require explicit `plugins.allow` configuration
2. Make plugin directories read-only after installation
3. Consider process-level isolation for untrusted plugins (child_process or worker_threads)
4. Implement npm signature verification for installed plugins

---

## 8. Secrets Management

### Current State

| Secret              | Location                                        | Encryption                 |
| ------------------- | ----------------------------------------------- | -------------------------- |
| API keys            | `~/.openclaw/.secrets.env`                      | None (plaintext, mode 600) |
| WhatsApp creds      | `~/.openclaw/credentials/whatsapp/*/creds.json` | None                       |
| Discord token       | Config/env                                      | None                       |
| Slack tokens        | Config/env                                      | None                       |
| Model auth profiles | `~/.openclaw/agents/*/agent/auth-profiles.json` | None                       |
| OAuth tokens        | `~/.openclaw/credentials/oauth.json`            | None                       |
| Gateway token       | Systemd service file                            | None                       |

### Vulnerabilities

- **No encryption at rest**: All credentials stored as plaintext
- **Backup exposure**: `.bak` files also plaintext
- **Model auth profiles accessible to agent code**: Stored in agent workspaces
- **Token in systemd config**: Readable by any process under the same user

### Recommendations

1. Implement encryption at rest for credential files (e.g., SOPS, age, or OS keychain)
2. Move all tokens to `.secrets.env` and reference via `EnvironmentFile=`
3. Restrict model auth profiles to gateway process only (not in agent workspace)

---

## 9. Audit and Logging

### Strengths

- **Structured logging**: Discord gateway events logged
- **Exec approval audit trail**: Records who approved/denied each request
- **Channel permission auditing**: `auditDiscordChannelPermissions()` validates bot permissions
- **Security audit command**: `openclaw security audit [--deep] [--fix]` flags common misconfigurations

### Vulnerabilities

- **No centralized tamper-proof audit log**: Logs go to console/files, not an append-only or remote log stream
- **Sensitive data in logs**: `logging.redactSensitive` defaults to "tools", not "all"
- **Session transcripts unencrypted on disk**: Full agent execution logs readable by any process with filesystem access

### Recommendations

1. Forward audit events to an external log aggregator (syslog, CloudWatch, etc.)
2. Default `redactSensitive` to "all" and require explicit opt-out
3. Encrypt session transcript files or restrict via filesystem permissions

---

## 10. Docker Deployment Security

### Strengths

- Drops ALL capabilities, only adds back CHOWN, SETUID, SETGID, SYS_ADMIN (for Chromium)
- `no-new-privileges: true`
- Resource limits: 2 CPU, 4GB RAM
- Non-root user
- Read-only secrets mount
- Loopback port binding
- Log rotation (10MB, 3 files)

### Vulnerabilities

- **SYS_ADMIN capability**: Required for Chromium sandbox but grants broad Linux capabilities
- **No AppArmor/SELinux profiles**: No mandatory access control
- **Host volume mounts**: `~/.openclaw` mounted directly, host permissions exposed
- **No user namespace remapping**: Container root maps to host UID

### Recommendations

1. Create AppArmor or SELinux profiles for the container
2. Enable user namespace remapping (`userns-remap`)
3. Consider rootless Docker or Podman for defense-in-depth

---

## 11. Network Exposure

### Current State

- Gateway on loopback only (127.0.0.1:18789)
- No public-facing endpoints
- Dashboard local-only (localhost:3000)
- No Tailscale Funnel enabled

### Potential Risks If Exposed

- **WebSocket hijacking**: If exposed without TLS, WS connections can be intercepted
- **Token brute-force**: No visible rate limiting on auth attempts
- **CORS**: Web UI cross-origin settings need verification if exposed

### Recommendations

1. If exposing via Tailscale, use Serve (HTTPS) not Funnel (public)
2. Add rate limiting to auth endpoints
3. Implement connection rate limiting at the gateway level

---

## Threat Model Summary

### What the AI agent can do:

- Execute arbitrary shell commands
- Read/write files
- Access network services
- Send messages to anyone (if given channel access)
- Spawn subagents
- Browse the web

### Who can trigger the agent:

- Allowlisted Discord users and channels
- Allowlisted DM users
- Local processes on the same machine

### Attack vectors:

1. **Prompt injection via external content** (web pages, emails, webhooks)
2. **Compromised allowlisted user** (social engineering)
3. **Malicious plugin** (supply chain attack)
4. **Filesystem access** (other processes reading secrets/transcripts)
5. **Network exposure** (misconfigured binding or tunnel)

### OpenClaw's security philosophy:

> "Identity first (who can talk), scope next (where the bot can act), model last (assume the model can be manipulated; limit blast radius)."

---

## Security Audit Checklist

Run regularly:

```bash
openclaw security audit        # Basic checks
openclaw security audit --deep # + live gateway probe
openclaw security audit --fix  # Auto-apply safe guardrails
```

Priority order:

1. Lock down DMs/groups (pairing/allowlists) + tighten tool policy
2. Fix public network exposure (LAN bind, missing auth)
3. Restrict browser control (tailnet-only, paired nodes)
4. Tighten file permissions (`~/.openclaw` -> 700, config -> 600)
5. Only load trusted plugins
6. Use modern, instruction-hardened models
