import process from "node:process";
import { normalizeLowercaseStringOrEmpty } from "../shared/string-coerce.js";
import { restoreTerminalState } from "../terminal/restore.js";
import {
  collectErrorGraphCandidates,
  extractErrorCode,
  formatUncaughtError,
  readErrorName,
} from "./errors.js";

type UnhandledRejectionHandler = (reason: unknown) => boolean;

const handlers = new Set<UnhandledRejectionHandler>();

const FATAL_ERROR_CODES = new Set([
  "ERR_OUT_OF_MEMORY",
  "ERR_SCRIPT_EXECUTION_TIMEOUT",
  "ERR_WORKER_OUT_OF_MEMORY",
  "ERR_WORKER_UNCAUGHT_EXCEPTION",
  "ERR_WORKER_INITIALIZATION_FAILED",
]);

const CONFIG_ERROR_CODES = new Set(["INVALID_CONFIG", "MISSING_API_KEY", "MISSING_CREDENTIALS"]);

// Network error codes that indicate transient failures (shouldn't crash the gateway)
const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "ECONNABORTED",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_DNS_RESOLVE_FAILED",
  "UND_ERR_CONNECT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "EPROTO",
  "ERR_SSL_WRONG_VERSION_NUMBER",
  "ERR_SSL_PROTOCOL_RETURNED_AN_ERROR",
]);

const TRANSIENT_NETWORK_ERROR_NAMES = new Set([
  "AbortError",
  "ConnectTimeoutError",
  "HeadersTimeoutError",
  "BodyTimeoutError",
  "TimeoutError",
]);

const TRANSIENT_SQLITE_CODES = new Set([
  "SQLITE_BUSY",
  "SQLITE_CANTOPEN",
  "SQLITE_IOERR",
  "SQLITE_LOCKED",
]);

const TRANSIENT_SQLITE_ERRCODES = new Set([5, 6, 10, 14]);

const TRANSIENT_NETWORK_MESSAGE_CODE_RE =
  /\b(ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ESOCKETTIMEDOUT|ECONNABORTED|EPIPE|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|EPROTO|UND_ERR_CONNECT_TIMEOUT|UND_ERR_DNS_RESOLVE_FAILED|UND_ERR_CONNECT|UND_ERR_SOCKET|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT)\b/i;

const TRANSIENT_SQLITE_MESSAGE_CODE_RE =
  /\b(SQLITE_BUSY|SQLITE_CANTOPEN|SQLITE_IOERR|SQLITE_LOCKED)\b/i;

const TRANSIENT_NETWORK_MESSAGE_SNIPPETS = [
  "getaddrinfo",
  "socket hang up",
  "client network socket disconnected before secure tls connection was established",
  "network error",
  "network is unreachable",
  "temporary failure in name resolution",
  "upstream connect error",
  "disconnect/reset before headers",
  "tlsv1 alert",
  "ssl routines",
  "packet length too long",
  "write eproto",
];

const TRANSIENT_SQLITE_MESSAGE_SNIPPETS = [
  "unable to open database file",
  "database is locked",
  "database table is locked",
  "disk i/o error",
];

function hasSqliteSignal(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }

  const code = extractErrorCode(err);
  if (typeof code === "string") {
    const normalizedCode = code.trim().toUpperCase();
    if (normalizedCode === "ERR_SQLITE_ERROR" || normalizedCode.startsWith("SQLITE_")) {
      return true;
    }
  }

  const name = normalizeLowercaseStringOrEmpty(readErrorName(err));
  if (name.includes("sqlite")) {
    return true;
  }

  const message =
    "message" in err && typeof err.message === "string"
      ? normalizeLowercaseStringOrEmpty(err.message)
      : "";
  if (message.includes("sqlite")) {
    return true;
  }

  return false;
}

function isWrappedFetchFailedMessage(message: string): boolean {
  if (message === "fetch failed") {
    return true;
  }

  // Keep wrapped variants (for example "...: fetch failed") while avoiding broad
  // matches like "Web fetch failed (404): ..." that are not transport failures.
  return /:\s*fetch failed$/.test(message);
}

function getErrorCause(err: unknown): unknown {
  if (!err || typeof err !== "object") {
    return undefined;
  }
  return (err as { cause?: unknown }).cause;
}

function extractErrorCodeOrErrno(err: unknown): string | undefined {
  const code = extractErrorCode(err);
  if (code) {
    return code.trim().toUpperCase();
  }
  if (!err || typeof err !== "object") {
    return undefined;
  }
  const errno = (err as { errno?: unknown }).errno;
  if (typeof errno === "string" && errno.trim()) {
    return errno.trim().toUpperCase();
  }
  if (typeof errno === "number" && Number.isFinite(errno)) {
    return String(errno);
  }
  return undefined;
}

function extractNumericErrorCode(err: unknown, key: "errno" | "errcode"): number | undefined {
  if (!err || typeof err !== "object") {
    return undefined;
  }
  const value = (err as Record<"errno" | "errcode", unknown>)[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function extractErrorCodeWithCause(err: unknown): string | undefined {
  const direct = extractErrorCode(err);
  if (direct) {
    return direct;
  }
  return extractErrorCode(getErrorCause(err));
}

/**
 * Checks if an error is an AbortError.
 * These are typically intentional cancellations (e.g., during shutdown) and shouldn't crash.
 */
export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const name = "name" in err ? String(err.name) : "";
  if (name === "AbortError") {
    return true;
  }
  // Check for "This operation was aborted" message from Node's undici
  const message = "message" in err && typeof err.message === "string" ? err.message : "";
  if (message === "This operation was aborted") {
    return true;
  }
  return false;
}

function isFatalError(err: unknown): boolean {
  const code = extractErrorCodeWithCause(err);
  return code !== undefined && FATAL_ERROR_CODES.has(code);
}

function isConfigError(err: unknown): boolean {
  const code = extractErrorCodeWithCause(err);
  return code !== undefined && CONFIG_ERROR_CODES.has(code);
}

function collectNestedUnhandledErrorCandidates(err: unknown): unknown[] {
  return collectErrorGraphCandidates(err, (current) => {
    const nested: Array<unknown> = [
      current.cause,
      current.reason,
      current.original,
      current.error,
      current.data,
    ];
    if (Array.isArray(current.errors)) {
      nested.push(...current.errors);
    }
    return nested;
  });
}

/**
 * Checks if an error is a transient network error that shouldn't crash the gateway.
 * These are typically temporary connectivity issues that will resolve on their own.
 */
export function isTransientNetworkError(err: unknown): boolean {
  if (!err) {
    return false;
  }
  for (const candidate of collectNestedUnhandledErrorCandidates(err)) {
    const code = extractErrorCodeOrErrno(candidate);
    if (code && TRANSIENT_NETWORK_CODES.has(code)) {
      return true;
    }

    const name = readErrorName(candidate);
    if (name && TRANSIENT_NETWORK_ERROR_NAMES.has(name)) {
      return true;
    }

    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    const rawMessage = (candidate as { message?: unknown }).message;
    const message = normalizeLowercaseStringOrEmpty(rawMessage);
    if (!message) {
      continue;
    }
    if (TRANSIENT_NETWORK_MESSAGE_CODE_RE.test(message)) {
      return true;
    }
    if (isWrappedFetchFailedMessage(message)) {
      return true;
    }
    if (TRANSIENT_NETWORK_MESSAGE_SNIPPETS.some((snippet) => message.includes(snippet))) {
      return true;
    }
  }

  return false;
}

export function isTransientSqliteError(err: unknown): boolean {
  if (!err) {
    return false;
  }

  for (const candidate of collectNestedUnhandledErrorCandidates(err)) {
    const code = extractErrorCodeOrErrno(candidate);
    if (code && TRANSIENT_SQLITE_CODES.has(code)) {
      return true;
    }

    if (!hasSqliteSignal(candidate)) {
      continue;
    }

    const sqliteErrcode = extractNumericErrorCode(candidate, "errcode");
    if (sqliteErrcode !== undefined && TRANSIENT_SQLITE_ERRCODES.has(sqliteErrcode)) {
      return true;
    }

    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const messageParts = [
      (candidate as { message?: unknown }).message,
      (candidate as { errstr?: unknown }).errstr,
    ];
    for (const rawMessage of messageParts) {
      const message = normalizeLowercaseStringOrEmpty(rawMessage);
      if (!message) {
        continue;
      }
      if (TRANSIENT_SQLITE_MESSAGE_CODE_RE.test(message)) {
        return true;
      }
      if (TRANSIENT_SQLITE_MESSAGE_SNIPPETS.some((snippet) => message.includes(snippet))) {
        return true;
      }
    }
  }

  return false;
}

export function isTransientUnhandledRejectionError(err: unknown): boolean {
  return isTransientNetworkError(err) || isTransientSqliteError(err);
}

export function registerUnhandledRejectionHandler(handler: UnhandledRejectionHandler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

export function isUnhandledRejectionHandled(reason: unknown): boolean {
  for (const handler of handlers) {
    try {
      if (handler(reason)) {
        return true;
      }
    } catch (err) {
      console.error(
        "[openclaw] Unhandled rejection handler failed:",
        err instanceof Error ? (err.stack ?? err.message) : err,
      );
    }
  }
  return false;
}

/**
 * Fork patch (2026-04-11): narrow matcher for undici's HTTP-socket-close TLS race.
 *
 * When `onHttpSocketClose` fires while a reconnect attempt is in flight, undici
 * calls `tls.connect({ socket: <already-closed httpSocket>, session })`. Node's
 * internal `_tls_wrap.js:TLSSocket.setSession` then tries to read the raw socket
 * handle from the closed httpSocket, which is `null`, and throws:
 *
 *   TypeError: Cannot read properties of null (reading 'setSession')
 *       at TLSSocket.setSession (node:_tls_wrap:1132:16)
 *       at Object.connect (node:_tls_wrap:1826:13)
 *       at Client.connect (undici/.../core/connect.js:70:20)
 *       at TLSSocket.onHttpSocketClose (undici/.../dispatcher/client-h1.js:942:18)
 *
 * This exception is thrown synchronously from an EventEmitter handler so it
 * surfaces as `uncaughtException`, not `unhandledRejection`. The dispatcher
 * itself recovers on the next request — the crash is purely a classification
 * miss. We therefore allow the process to keep running when we see the exact
 * crash pattern.
 *
 * Safety: the match is narrow on purpose. It requires ALL of:
 *   1. `TypeError` instance (rules out most user bugs that name themselves Error)
 *   2. exact message `"Cannot read properties of null (reading 'setSession')"`
 *   3. stack frame inside `_tls_wrap` (confirms it's a Node TLS internal crash)
 *   4. stack frame inside `undici/lib/dispatcher` or named `onHttpSocketClose`
 *      (confirms undici triggered the bad reconnect)
 *
 * If you break this out to a wider pattern, preserve the stack check — we do
 * NOT want to swallow null-property TypeErrors from our own code.
 */
export function isUndiciTlsSessionRace(err: unknown): boolean {
  if (!(err instanceof TypeError)) {
    return false;
  }
  if (!/cannot read properties of null \(reading 'setSession'\)/i.test(err.message)) {
    return false;
  }
  const stack = typeof err.stack === "string" ? err.stack : "";
  if (!stack.includes("_tls_wrap")) {
    return false;
  }
  return stack.includes("undici/lib/dispatcher") || stack.includes("onHttpSocketClose");
}

/**
 * Checks if an uncaught exception is recoverable (should not crash the gateway).
 * Covers transient network errors, Discord gateway reconnection bugs, and abort errors.
 */
export function isRecoverableException(err: unknown): boolean {
  if (isAbortError(err)) {
    return true;
  }
  if (isTransientNetworkError(err)) {
    return true;
  }
  // @buape/carbon GatewayPlugin throws synchronous errors from heartbeat timers
  // when Discord WebSocket connections enter zombie state. These are non-fatal;
  // the gateway will re-establish the connection on the next cycle.
  if (err instanceof Error && /reconnect.*zombie|zombie.*reconnect/i.test(err.message)) {
    return true;
  }
  // Fork patch (2026-04-11): tolerate the undici onHttpSocketClose TLS race that
  // caused a 15-hour systemd restart loop on 2026-04-10. See isUndiciTlsSessionRace.
  if (isUndiciTlsSessionRace(err)) {
    return true;
  }
  return false;
}

export function installUnhandledRejectionHandler(): void {
  const exitWithTerminalRestore = (reason: string) => {
    restoreTerminalState(reason, { resumeStdinIfPaused: false });
    process.exit(1);
  };

  process.on("unhandledRejection", (reason, _promise) => {
    if (isUnhandledRejectionHandled(reason)) {
      return;
    }

    // AbortError is typically an intentional cancellation (e.g., during shutdown)
    // Log it but don't crash - these are expected during graceful shutdown
    if (isAbortError(reason)) {
      console.warn("[openclaw] Suppressed AbortError:", formatUncaughtError(reason));
      return;
    }

    if (isFatalError(reason)) {
      console.error("[openclaw] FATAL unhandled rejection:", formatUncaughtError(reason));
      exitWithTerminalRestore("fatal unhandled rejection");
      return;
    }

    if (isConfigError(reason)) {
      console.error("[openclaw] CONFIGURATION ERROR - requires fix:", formatUncaughtError(reason));
      exitWithTerminalRestore("configuration error");
      return;
    }

    if (isTransientUnhandledRejectionError(reason)) {
      console.warn(
        "[openclaw] Non-fatal unhandled rejection (continuing):",
        formatUncaughtError(reason),
      );
      return;
    }

    console.error("[openclaw] Unhandled promise rejection:", formatUncaughtError(reason));
    exitWithTerminalRestore("unhandled rejection");
  });
}
