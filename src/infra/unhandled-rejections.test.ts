import { describe, expect, it } from "vitest";
import {
  isAbortError,
  isRecoverableException,
  isTransientNetworkError,
  isTransientSqliteError,
  isTransientUnhandledRejectionError,
  isUndiciTlsSessionRace,
} from "./unhandled-rejections.js";

describe("isAbortError", () => {
  it("returns true for error with name AbortError", () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    expect(isAbortError(error)).toBe(true);
  });

  it('returns true for error with "This operation was aborted" message', () => {
    const error = new Error("This operation was aborted");
    expect(isAbortError(error)).toBe(true);
  });

  it("returns true for undici-style AbortError", () => {
    // Node's undici throws errors with this exact message
    const error = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    expect(isAbortError(error)).toBe(true);
  });

  it("returns true for object with AbortError name", () => {
    expect(isAbortError({ name: "AbortError", message: "test" })).toBe(true);
  });

  it("returns false for regular errors", () => {
    expect(isAbortError(new Error("Something went wrong"))).toBe(false);
    expect(isAbortError(new TypeError("Cannot read property"))).toBe(false);
    expect(isAbortError(new RangeError("Invalid array length"))).toBe(false);
  });

  it("returns false for errors with similar but different messages", () => {
    expect(isAbortError(new Error("Operation aborted"))).toBe(false);
    expect(isAbortError(new Error("aborted"))).toBe(false);
    expect(isAbortError(new Error("Request was aborted"))).toBe(false);
  });

  it.each([null, undefined, "string error", 42, { message: "plain object" }])(
    "returns false for non-abort input %#",
    (value) => {
      expect(isAbortError(value)).toBe(false);
    },
  );
});

describe("isTransientNetworkError", () => {
  it("returns true for errors with transient network codes", () => {
    const codes = [
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
      "EPROTO",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_SOCKET",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_BODY_TIMEOUT",
      "ERR_SSL_WRONG_VERSION_NUMBER",
      "ERR_SSL_PROTOCOL_RETURNED_AN_ERROR",
    ];

    for (const code of codes) {
      const error = Object.assign(new Error("test"), { code });
      expect(isTransientNetworkError(error), `code: ${code}`).toBe(true);
    }
  });

  it('returns true for TypeError with "fetch failed" message', () => {
    const error = new TypeError("fetch failed");
    expect(isTransientNetworkError(error)).toBe(true);
  });

  it("returns true for fetch failed with network cause", () => {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    const error = Object.assign(new TypeError("fetch failed"), { cause });
    expect(isTransientNetworkError(error)).toBe(true);
  });

  it("returns true for fetch failed with unclassified cause", () => {
    const cause = Object.assign(new Error("unknown socket state"), { code: "UNKNOWN" });
    const error = Object.assign(new TypeError("fetch failed"), { cause });
    expect(isTransientNetworkError(error)).toBe(true);
  });

  it("returns true for nested cause chain with network error", () => {
    const innerCause = Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
    const outerCause = Object.assign(new Error("wrapper"), { cause: innerCause });
    const error = Object.assign(new TypeError("fetch failed"), { cause: outerCause });
    expect(isTransientNetworkError(error)).toBe(true);
  });

  it("returns true for Slack request errors that wrap network codes in .original", () => {
    const error = Object.assign(new Error("A request error occurred: getaddrinfo EAI_AGAIN"), {
      code: "slack_webapi_request_error",
      original: {
        errno: -3001,
        code: "EAI_AGAIN",
        syscall: "getaddrinfo",
        hostname: "slack.com",
      },
    });
    expect(isTransientNetworkError(error)).toBe(true);
  });

  it("returns true for network codes nested in .data payloads", () => {
    const error = {
      code: "slack_webapi_request_error",
      message: "A request error occurred",
      data: {
        code: "EAI_AGAIN",
      },
    };
    expect(isTransientNetworkError(error)).toBe(true);
  });

  it("returns true for AggregateError containing network errors", () => {
    const networkError = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    const error = new AggregateError([networkError], "Multiple errors");
    expect(isTransientNetworkError(error)).toBe(true);
  });

  it("returns true for wrapped fetch-failed messages from integration clients", () => {
    const error = new Error("Failed to get gateway information from Discord: fetch failed");
    expect(isTransientNetworkError(error)).toBe(true);
  });

  it("returns true for wrapped Discord upstream-connect parse failures", () => {
    const error = new Error(
      `Failed to get gateway information from Discord: Unexpected token 'u', "upstream connect error or disconnect/reset before headers. reset reason: overflow" is not valid JSON`,
    );
    expect(isTransientNetworkError(error)).toBe(true);
  });

  it("returns false for non-network fetch-failed wrappers from tools", () => {
    const error = new Error("Web fetch failed (404): Not Found");
    expect(isTransientNetworkError(error)).toBe(false);
  });

  it("returns true for TLS/SSL transient message snippets", () => {
    expect(isTransientNetworkError(new Error("write EPROTO 00A8B0C9:error"))).toBe(true);
    expect(
      isTransientNetworkError(
        new Error("SSL routines:OPENSSL_internal:WRONG_VERSION_NUMBER while connecting"),
      ),
    ).toBe(true);
    expect(isTransientNetworkError(new Error("tlsv1 alert protocol version"))).toBe(true);
  });

  it("returns false for regular errors without network codes", () => {
    expect(isTransientNetworkError(new Error("Something went wrong"))).toBe(false);
    expect(isTransientNetworkError(new TypeError("Cannot read property"))).toBe(false);
    expect(isTransientNetworkError(new RangeError("Invalid array length"))).toBe(false);
  });

  it("returns false for errors with non-network codes", () => {
    const error = Object.assign(new Error("test"), { code: "INVALID_CONFIG" });
    expect(isTransientNetworkError(error)).toBe(false);
  });

  it("returns false for Slack request errors without network indicators", () => {
    const error = Object.assign(new Error("A request error occurred"), {
      code: "slack_webapi_request_error",
    });
    expect(isTransientNetworkError(error)).toBe(false);
  });

  it("returns false for non-transient undici codes that only appear in message text", () => {
    const error = new Error("Request failed with UND_ERR_INVALID_ARG");
    expect(isTransientNetworkError(error)).toBe(false);
  });

  it.each([null, undefined, "string error", 42, { message: "plain object" }])(
    "returns false for non-network input %#",
    (value) => {
      expect(isTransientNetworkError(value)).toBe(false);
    },
  );

  it("returns false for AggregateError with only non-network errors", () => {
    const error = new AggregateError([new Error("regular error")], "Multiple errors");
    expect(isTransientNetworkError(error)).toBe(false);
  });
});

describe("isTransientSqliteError", () => {
  it("returns true for named transient SQLite codes", () => {
    const codes = ["SQLITE_CANTOPEN", "SQLITE_BUSY", "SQLITE_LOCKED", "SQLITE_IOERR"];

    for (const code of codes) {
      const error = Object.assign(new Error("sqlite transient"), { code });
      expect(isTransientSqliteError(error), `code: ${code}`).toBe(true);
    }
  });

  it("returns true for node:sqlite transient errcodes", () => {
    const sqliteCases = [
      { errcode: 14, errstr: "unable to open database file" },
      { errcode: 5, errstr: "database is locked" },
      { errcode: 6, errstr: "database table is locked" },
      { errcode: 10, errstr: "disk I/O error" },
    ] as const;

    for (const { errcode, errstr } of sqliteCases) {
      const error = Object.assign(new Error(errstr), {
        code: "ERR_SQLITE_ERROR",
        errcode,
        errstr,
      });
      expect(isTransientSqliteError(error), `errcode: ${errcode}`).toBe(true);
    }
  });

  it("returns true for wrapped SQLite message strings", () => {
    const error = new Error("SQLITE_BUSY: database is locked");
    expect(isTransientSqliteError(error)).toBe(true);
  });

  it("returns false for non-transient SQLite failures", () => {
    const constraintError = Object.assign(new Error("UNIQUE constraint failed"), {
      code: "SQLITE_CONSTRAINT",
    });
    const genericSqliteError = Object.assign(new Error("constraint failed"), {
      code: "ERR_SQLITE_ERROR",
      errcode: 19,
      errstr: "constraint failed",
    });

    expect(isTransientSqliteError(constraintError)).toBe(false);
    expect(isTransientSqliteError(genericSqliteError)).toBe(false);
  });

  it("returns false for matching errcodes without SQLite context", () => {
    const error = Object.assign(new Error("plain error"), {
      code: "ERR_OTHER",
      errcode: 14,
      errstr: "unable to open database file",
    });

    expect(isTransientSqliteError(error)).toBe(false);
  });

  it("returns false for SQLite-like snippets without SQLite context", () => {
    const error = new Error("database is locked");

    expect(isTransientSqliteError(error)).toBe(false);
  });
});

describe("isTransientUnhandledRejectionError", () => {
  it("returns true for transient SQLite errors", () => {
    const error = Object.assign(new Error("unable to open database file"), {
      code: "ERR_SQLITE_ERROR",
      errcode: 14,
      errstr: "unable to open database file",
    });

    expect(isTransientUnhandledRejectionError(error)).toBe(true);
  });
});

// Fork patch (2026-04-11): matcher for the undici HTTP-socket-close TLS race.
// The real 2026-04-10 crash stack is reproduced verbatim below — update the
// fixture, not the matcher, if undici renames files or frames.
describe("isUndiciTlsSessionRace", () => {
  const realCrashStack = [
    "TypeError: Cannot read properties of null (reading 'setSession')",
    "    at TLSSocket.setSession (node:_tls_wrap:1132:16)",
    "    at Object.connect (node:_tls_wrap:1826:13)",
    "    at Client.connect (/home/azureuser/openclaw/node_modules/.pnpm/undici@7.22.0/node_modules/undici/lib/core/connect.js:70:20)",
    "    at connect (/home/azureuser/openclaw/node_modules/.pnpm/undici@7.22.0/node_modules/undici/lib/dispatcher/client.js:452:21)",
    "    at _resume (/home/azureuser/openclaw/node_modules/.pnpm/undici@7.22.0/node_modules/undici/lib/dispatcher/client.js:627:7)",
    "    at resume (/home/azureuser/openclaw/node_modules/.pnpm/undici@7.22.0/node_modules/undici/lib/dispatcher/client.js:561:3)",
    "    at Client.<computed> (/home/azureuser/openclaw/node_modules/.pnpm/undici@7.22.0/node_modules/undici/lib/dispatcher/client.js:285:31)",
    "    at TLSSocket.onHttpSocketClose (/home/azureuser/openclaw/node_modules/.pnpm/undici@7.22.0/node_modules/undici/lib/dispatcher/client-h1.js:942:18)",
    "    at TLSSocket.emit (node:events:531:35)",
    "    at node:net:346:12",
    "    at TCP.done (node:_tls_wrap:667:7)",
  ].join("\n");

  function buildRealCrash(): TypeError {
    const err = new TypeError("Cannot read properties of null (reading 'setSession')");
    err.stack = realCrashStack;
    return err;
  }

  it("matches the real 2026-04-10 undici onHttpSocketClose crash", () => {
    expect(isUndiciTlsSessionRace(buildRealCrash())).toBe(true);
  });

  it("returns true inside isRecoverableException", () => {
    expect(isRecoverableException(buildRealCrash())).toBe(true);
  });

  it("does not match generic TypeError with same message but unrelated stack", () => {
    const err = new TypeError("Cannot read properties of null (reading 'setSession')");
    err.stack = `${err.message}\n    at Object.<anonymous> (/home/azureuser/openclaw/src/some-unrelated.ts:42:10)`;
    expect(isUndiciTlsSessionRace(err)).toBe(false);
  });

  it("does not match undici-stack TypeError with a different message", () => {
    const err = new TypeError("Cannot read properties of null (reading 'end')");
    err.stack = [
      err.message,
      "    at TLSSocket.foo (node:_tls_wrap:99:1)",
      "    at TLSSocket.onHttpSocketClose (undici/lib/dispatcher/client-h1.js:942:18)",
    ].join("\n");
    expect(isUndiciTlsSessionRace(err)).toBe(false);
  });

  it("does not match a plain Error with matching message (not a TypeError)", () => {
    const err = new Error("Cannot read properties of null (reading 'setSession')");
    err.stack = realCrashStack;
    expect(isUndiciTlsSessionRace(err)).toBe(false);
  });

  it("does not match a setSession TypeError outside undici (only _tls_wrap)", () => {
    const err = new TypeError("Cannot read properties of null (reading 'setSession')");
    err.stack = [
      err.message,
      "    at TLSSocket.setSession (node:_tls_wrap:1132:16)",
      "    at Object.<anonymous> (/home/azureuser/openclaw/src/custom-tls.ts:10:5)",
    ].join("\n");
    expect(isUndiciTlsSessionRace(err)).toBe(false);
  });
});
