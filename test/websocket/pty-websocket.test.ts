import { EventEmitter } from "node:events";
import { describe, it, expect, vi, afterEach } from "vitest";
// @ts-expect-error -- src/pty-websocket.js is native ESM JS, no .d.ts emitted.
import {
  encodeFrame,
  createWebSocketAcceptValue,
  createHttpErrorResponse,
  rejectWebSocketUpgrade,
  acceptWebSocketUpgrade,
  normalizePositiveInteger,
  buildPtyEnv,
  parseWebSocketFrame,
  unmaskPayload
} from "../../src/pty-websocket.js";

describe("encodeFrame", () => {
  it("encodes a short text frame with a 2-byte header and FIN bit", () => {
    const payload = Buffer.from("hi", "utf8");
    const frame = encodeFrame(0x1, payload);

    expect(frame.length).toBe(2 + payload.length);
    expect(frame[0]).toBe(0x81); // FIN=1 | opcode=0x1 (text)
    expect(frame[1]).toBe(payload.length); // unmasked, length < 126
    expect(frame.subarray(2).equals(payload)).toBe(true);
  });

  it("encodes a medium payload with a 4-byte header and 16-bit length", () => {
    const payload = Buffer.alloc(200, 0x61); // 200 bytes of 'a'
    const frame = encodeFrame(0x2, payload);

    expect(frame.length).toBe(4 + payload.length);
    expect(frame[0]).toBe(0x82); // FIN=1 | opcode=0x2 (binary)
    expect(frame[1]).toBe(126); // extended length marker
    expect(frame.readUInt16BE(2)).toBe(200);
    expect(frame.subarray(4).equals(payload)).toBe(true);
  });

  it("encodes a large payload with a 10-byte header and 64-bit length", () => {
    const payload = Buffer.alloc(70000, 0x62);
    const frame = encodeFrame(0x1, payload);

    expect(frame.length).toBe(10 + payload.length);
    expect(frame[0]).toBe(0x81);
    expect(frame[1]).toBe(127);
    expect(Number(frame.readBigUInt64BE(2))).toBe(70000);
    expect(frame.subarray(10).equals(payload)).toBe(true);
  });

  it("defaults to an empty payload when no buffer is supplied", () => {
    const frame = encodeFrame(0x8);

    expect(frame.length).toBe(2);
    expect(frame[0]).toBe(0x88); // FIN=1 | opcode=0x8 (close)
    expect(frame[1]).toBe(0);
  });

  it("encodes a ping frame (opcode 0x9)", () => {
    const frame = encodeFrame(0x9, Buffer.from("p"));
    expect(frame[0]).toBe(0x89);
    expect(frame[1]).toBe(1);
  });

  it("encodes a pong frame (opcode 0xA)", () => {
    const frame = encodeFrame(0xa, Buffer.from("p"));
    expect(frame[0]).toBe(0x8a);
    expect(frame[1]).toBe(1);
  });

  it("encodes the exact 126-byte boundary with a 16-bit length header", () => {
    const payload = Buffer.alloc(126, 0x63);
    const frame = encodeFrame(0x1, payload);

    expect(frame.length).toBe(4 + 126);
    expect(frame[1]).toBe(126);
    expect(frame.readUInt16BE(2)).toBe(126);
  });

  it("encodes the exact 65535-byte boundary with a 16-bit length header", () => {
    const payload = Buffer.alloc(65535, 0x64);
    const frame = encodeFrame(0x1, payload);

    expect(frame.length).toBe(4 + 65535);
    expect(frame[1]).toBe(126);
    expect(frame.readUInt16BE(2)).toBe(65535);
  });

  it("encodes the 65536-byte boundary with a 64-bit length header", () => {
    const payload = Buffer.alloc(65536, 0x65);
    const frame = encodeFrame(0x1, payload);

    expect(frame.length).toBe(10 + 65536);
    expect(frame[1]).toBe(127);
    expect(Number(frame.readBigUInt64BE(2))).toBe(65536);
  });
});

describe("createWebSocketAcceptValue", () => {
  it("matches the RFC 6455 Sec-WebSocket-Accept example", () => {
    // RFC 6455 §1.3 worked example:
    //   Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
    //   Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
    expect(createWebSocketAcceptValue("dGhlIHNhbXBsZSBub25jZQ==")).toBe(
      "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
    );
  });

  it("is deterministic for identical keys", () => {
    const key = "x3JJHMbDL1EzLkh9GBhXDw==";
    expect(createWebSocketAcceptValue(key)).toBe(createWebSocketAcceptValue(key));
  });

  it("produces different accept values for different keys", () => {
    expect(createWebSocketAcceptValue("a".repeat(16))).not.toBe(
      createWebSocketAcceptValue("b".repeat(16))
    );
  });
});

describe("createHttpErrorResponse", () => {
  it("formats a 400 Bad Request with JSON error body", () => {
    const response = createHttpErrorResponse(400, "paneId is required");

    expect(response.startsWith("HTTP/1.1 400 Bad Request\r\n")).toBe(true);
    expect(response).toContain("Content-Type: application/json; charset=utf-8");
    expect(response).toContain("Connection: close");
    expect(response.endsWith('{"error":"paneId is required"}')).toBe(true);
  });

  it("formats a 401 Unauthorized", () => {
    const response = createHttpErrorResponse(401, "로그인이 필요합니다.");
    expect(response.startsWith("HTTP/1.1 401 Unauthorized\r\n")).toBe(true);
  });

  it("formats a 404 Not Found", () => {
    const response = createHttpErrorResponse(404, "missing");
    expect(response.startsWith("HTTP/1.1 404 Not Found\r\n")).toBe(true);
  });

  it("falls back to Internal Server Error for unknown status codes", () => {
    const response = createHttpErrorResponse(500, "boom");
    expect(response.startsWith("HTTP/1.1 500 Internal Server Error\r\n")).toBe(true);
  });

  it("advertises accurate Content-Length for UTF-8 bodies", () => {
    const message = "로그인이 필요합니다.";
    const response = createHttpErrorResponse(401, message);
    const expectedLength = Buffer.byteLength(JSON.stringify({ error: message }));
    expect(response).toContain(`Content-Length: ${expectedLength}`);
  });
});

describe("rejectWebSocketUpgrade", () => {
  it("writes the HTTP error response and destroys the socket", () => {
    const write = vi.fn();
    const destroy = vi.fn();
    const socket = { write, destroy };

    rejectWebSocketUpgrade(socket, 400, "paneId is required");

    expect(write).toHaveBeenCalledOnce();
    const written = write.mock.calls[0][0] as string;
    expect(written.startsWith("HTTP/1.1 400 Bad Request\r\n")).toBe(true);
    expect(written).toContain('"error":"paneId is required"');
    expect(destroy).toHaveBeenCalledOnce();
  });
});

describe("normalizePositiveInteger", () => {
  it("returns the value when it is a positive integer", () => {
    expect(normalizePositiveInteger(42, 99)).toBe(42);
  });

  it("returns the fallback for zero", () => {
    expect(normalizePositiveInteger(0, 7)).toBe(7);
  });

  it("returns the fallback for a negative integer", () => {
    expect(normalizePositiveInteger(-5, 7)).toBe(7);
  });

  it("returns the fallback for a fractional number", () => {
    expect(normalizePositiveInteger(3.14, 7)).toBe(7);
  });

  it("returns the fallback for NaN", () => {
    expect(normalizePositiveInteger(Number.NaN, 7)).toBe(7);
  });

  it("returns the fallback for undefined", () => {
    expect(normalizePositiveInteger(undefined, 7)).toBe(7);
  });

  it("returns the fallback for null", () => {
    expect(normalizePositiveInteger(null, 7)).toBe(7);
  });

  it("coerces numeric strings to positive integers", () => {
    expect(normalizePositiveInteger("120", 7)).toBe(120);
  });

  it("returns the fallback for non-numeric strings", () => {
    expect(normalizePositiveInteger("abc", 7)).toBe(7);
  });

  it("returns the fallback for an empty string", () => {
    // Number("") === 0 which is not positive.
    expect(normalizePositiveInteger("", 7)).toBe(7);
  });
});

describe("buildPtyEnv", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      process.env[key] = value;
    }
  });

  it("sets TERM to xterm-256color", () => {
    const env = buildPtyEnv();
    expect(env.TERM).toBe("xterm-256color");
  });

  it("removes TMUX and TMUX_PANE from the parent environment", () => {
    process.env.TMUX = "/tmp/tmux-1000/default,1234,0";
    process.env.TMUX_PANE = "%0";

    const env = buildPtyEnv();

    expect(env.TMUX).toBeUndefined();
    expect(env.TMUX_PANE).toBeUndefined();
  });

  it("inherits other environment variables (e.g. PATH) from process.env", () => {
    process.env.PATH = "/usr/bin:/bin";
    process.env.CUSTOM_VAR = "value-123";

    const env = buildPtyEnv();

    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(env.CUSTOM_VAR).toBe("value-123");
  });

  it("returns a fresh object that does not mutate process.env", () => {
    process.env.TMUX = "outer";
    const env = buildPtyEnv();

    // Caller's copy has TMUX stripped,
    // but process.env still has it.
    expect(env.TMUX).toBeUndefined();
    expect(process.env.TMUX).toBe("outer");
  });

  it("overrides any pre-existing TERM value in the parent environment", () => {
    process.env.TERM = "dumb";
    const env = buildPtyEnv();
    expect(env.TERM).toBe("xterm-256color");
  });
});

describe("unmaskPayload", () => {
  it("XORs the payload byte-by-byte with the 4-byte mask", () => {
    const mask = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    const original = Buffer.from("hello", "utf8");
    const masked = Buffer.from([
      original[0] ^ mask[0],
      original[1] ^ mask[1],
      original[2] ^ mask[2],
      original[3] ^ mask[3],
      original[4] ^ mask[0] // cycles
    ]);

    expect(unmaskPayload(masked, mask).equals(original)).toBe(true);
  });

  it("is its own inverse (unmask ∘ unmask = identity)", () => {
    const mask = Buffer.from([0x37, 0xfa, 0x21, 0x3d]);
    const original = Buffer.from([0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70]);
    const masked = unmaskPayload(original, mask);
    const roundTrip = unmaskPayload(masked, mask);

    expect(roundTrip.equals(original)).toBe(true);
  });

  it("returns an empty buffer for an empty payload", () => {
    const mask = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]);
    const result = unmaskPayload(Buffer.alloc(0), mask);

    expect(result.length).toBe(0);
  });

  it("cycles the mask index for payloads longer than 4 bytes", () => {
    const mask = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    const payload = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x01, 0x02]);
    // payload[i] ^ mask[i % 4] === 0 for all i
    const result = unmaskPayload(payload, mask);

    expect([...result]).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

function buildMaskedTextFrame(text: string, mask: Buffer): Buffer {
  const payload = Buffer.from(text, "utf8");
  const masked = Buffer.allocUnsafe(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    masked[index] = payload[index] ^ mask[index % 4];
  }

  const header = Buffer.from([0x81, 0x80 | payload.length]);
  return Buffer.concat([header, mask, masked]);
}

describe("parseWebSocketFrame", () => {
  it("returns null when the buffer has fewer than 2 bytes", () => {
    expect(parseWebSocketFrame(Buffer.alloc(0))).toBeNull();
    expect(parseWebSocketFrame(Buffer.from([0x81]))).toBeNull();
  });

  it("decodes an unmasked short text frame", () => {
    const frame = encodeFrame(0x1, Buffer.from("hi", "utf8"));
    const result = parseWebSocketFrame(frame);

    expect(result).not.toBeNull();
    expect(result!.frame.opcode).toBe(0x1);
    expect(result!.frame.payload.toString("utf8")).toBe("hi");
    expect(result!.remaining.length).toBe(0);
  });

  it("decodes a masked short text frame", () => {
    const mask = Buffer.from([0x11, 0x22, 0x33, 0x44]);
    const frame = buildMaskedTextFrame("hello", mask);
    const result = parseWebSocketFrame(frame);

    expect(result).not.toBeNull();
    expect(result!.frame.opcode).toBe(0x1);
    expect(result!.frame.payload.toString("utf8")).toBe("hello");
  });

  it("returns null when the payload is incomplete (short)", () => {
    const full = encodeFrame(0x1, Buffer.from("abcdef", "utf8"));
    const truncated = full.subarray(0, full.length - 2);
    expect(parseWebSocketFrame(truncated)).toBeNull();
  });

  it("returns null when a 16-bit extended length header is incomplete", () => {
    // 0x81 then length marker 126 but missing the 2 extended-length bytes.
    const buffer = Buffer.from([0x81, 126]);
    expect(parseWebSocketFrame(buffer)).toBeNull();
  });

  it("returns null when a 64-bit extended length header is incomplete", () => {
    // 0x81 then length marker 127 but only 4 of 8 extended-length bytes.
    const buffer = Buffer.from([0x81, 127, 0, 0, 0, 0]);
    expect(parseWebSocketFrame(buffer)).toBeNull();
  });

  it("decodes a medium payload with 16-bit extended length", () => {
    const payload = Buffer.alloc(200, 0x7a);
    const frame = encodeFrame(0x1, payload);
    const result = parseWebSocketFrame(frame);

    expect(result).not.toBeNull();
    expect(result!.frame.payload.length).toBe(200);
    expect(result!.frame.payload.equals(payload)).toBe(true);
    expect(result!.remaining.length).toBe(0);
  });

  it("decodes a large payload with 64-bit extended length", () => {
    const payload = Buffer.alloc(70000, 0x7b);
    const frame = encodeFrame(0x1, payload);
    const result = parseWebSocketFrame(frame);

    expect(result).not.toBeNull();
    expect(result!.frame.payload.length).toBe(70000);
    expect(result!.frame.payload.equals(payload)).toBe(true);
  });

  it("identifies close (0x8) and ping (0x9) opcodes without interpreting them", () => {
    const closeFrame = encodeFrame(0x8);
    const pingFrame = encodeFrame(0x9, Buffer.from("hb"));

    expect(parseWebSocketFrame(closeFrame)!.frame.opcode).toBe(0x8);
    expect(parseWebSocketFrame(pingFrame)!.frame.opcode).toBe(0x9);
  });

  it("returns the trailing bytes as `remaining` when the buffer holds multiple frames", () => {
    const first = encodeFrame(0x1, Buffer.from("one"));
    const second = encodeFrame(0x1, Buffer.from("two"));
    const combined = Buffer.concat([first, second]);

    const result = parseWebSocketFrame(combined);
    expect(result!.frame.payload.toString("utf8")).toBe("one");
    expect(result!.remaining.equals(second)).toBe(true);

    const next = parseWebSocketFrame(result!.remaining);
    expect(next!.frame.payload.toString("utf8")).toBe("two");
    expect(next!.remaining.length).toBe(0);
  });

  it("round-trips a masked payload with a 16-bit extended length", () => {
    const mask = Buffer.from([0x5a, 0xa5, 0x33, 0xcc]);
    const raw = Buffer.alloc(300, 0x2e);
    const masked = Buffer.allocUnsafe(raw.length);
    for (let index = 0; index < raw.length; index += 1) {
      masked[index] = raw[index] ^ mask[index % 4];
    }

    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(raw.length, 2);
    const frame = Buffer.concat([header, mask, masked]);

    const result = parseWebSocketFrame(frame);

    expect(result).not.toBeNull();
    expect(result!.frame.payload.equals(raw)).toBe(true);
  });
});

// Mock socket that emulates the subset of net.Socket behaviour that
// acceptWebSocketUpgrade relies on: write/end/destroy/unshift + 'data'/'close'/'end'/'error' events.
class MockSocket extends EventEmitter {
  writes: Buffer[] = [];
  ended = false;
  destroyed = false;
  unshiftedChunks: Buffer[] = [];

  write(chunk: string | Buffer): boolean {
    this.writes.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    return true;
  }

  end(): void {
    this.ended = true;
  }

  destroy(): void {
    this.destroyed = true;
  }

  unshift(chunk: Buffer): void {
    this.unshiftedChunks.push(chunk);
  }
}

function maskedTextFrame(text: string, mask = Buffer.from([0x01, 0x02, 0x03, 0x04])): Buffer {
  const payload = Buffer.from(text, "utf8");
  const masked = Buffer.allocUnsafe(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    masked[index] = payload[index] ^ mask[index % 4];
  }
  const header = Buffer.from([0x81, 0x80 | payload.length]);
  return Buffer.concat([header, mask, masked]);
}

describe("acceptWebSocketUpgrade", () => {
  it("rejects the upgrade when Sec-WebSocket-Key is missing", () => {
    const socket = new MockSocket();
    const request = { headers: {} };

    const result = acceptWebSocketUpgrade(request, socket);

    expect(result).toBeNull();
    expect(socket.writes.length).toBe(1);
    expect(socket.writes[0].toString("utf8").startsWith("HTTP/1.1 400")).toBe(true);
    expect(socket.destroyed).toBe(true);
  });

  it("writes the RFC 6455 101 Switching Protocols handshake with the expected Accept header", () => {
    const socket = new MockSocket();
    const request = { headers: { "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" } };

    const api = acceptWebSocketUpgrade(request, socket);

    expect(api).not.toBeNull();
    const handshake = socket.writes[0].toString("utf8");
    expect(handshake.startsWith("HTTP/1.1 101 Switching Protocols\r\n")).toBe(true);
    expect(handshake).toContain("Upgrade: websocket");
    expect(handshake).toContain("Connection: Upgrade");
    expect(handshake).toContain("Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
  });

  it("unshifts the provided `head` buffer back onto the socket", () => {
    const socket = new MockSocket();
    const request = { headers: { "sec-websocket-key": "key" } };
    const head = Buffer.from([0xde, 0xad]);

    acceptWebSocketUpgrade(request, socket, head);

    expect(socket.unshiftedChunks.length).toBe(1);
    expect(socket.unshiftedChunks[0].equals(head)).toBe(true);
  });

  it("routes masked text frames to onText listeners", () => {
    const socket = new MockSocket();
    const request = { headers: { "sec-websocket-key": "key" } };

    const api = acceptWebSocketUpgrade(request, socket);
    const onText = vi.fn();
    api.onText(onText);

    socket.emit("data", maskedTextFrame("hello"));

    expect(onText).toHaveBeenCalledWith("hello");
  });

  it("echoes ping frames with a pong frame carrying the same payload", () => {
    const socket = new MockSocket();
    const request = { headers: { "sec-websocket-key": "key" } };

    acceptWebSocketUpgrade(request, socket);

    // Build a ping (opcode 0x9) with a 2-byte payload.
    const mask = Buffer.from([0x10, 0x20, 0x30, 0x40]);
    const payload = Buffer.from("hb", "utf8");
    const masked = Buffer.from([payload[0] ^ mask[0], payload[1] ^ mask[1]]);
    const ping = Buffer.concat([Buffer.from([0x89, 0x80 | 2]), mask, masked]);

    socket.emit("data", ping);

    // The handshake is writes[0]; the pong should be the next write.
    const pong = socket.writes[1];
    expect(pong).toBeDefined();
    expect(pong[0]).toBe(0x8a); // FIN | opcode 0xA (pong)
    expect(pong[1]).toBe(payload.length);
    expect(pong.subarray(2).equals(payload)).toBe(true);
  });

  it("handles a close frame from the peer by sending close and emitting onClose", () => {
    const socket = new MockSocket();
    const request = { headers: { "sec-websocket-key": "key" } };

    const api = acceptWebSocketUpgrade(request, socket);
    const onClose = vi.fn();
    api.onClose(onClose);

    // Client-initiated close frame (masked, empty payload).
    const closeFrame = Buffer.from([0x88, 0x80, 0, 0, 0, 0]);
    socket.emit("data", closeFrame);

    // Writes: [handshake, close frame]
    const closeEcho = socket.writes[1];
    expect(closeEcho[0]).toBe(0x88);
    expect(socket.ended).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });

  it("sendJson writes a text frame containing the JSON-serialised payload", () => {
    const socket = new MockSocket();
    const request = { headers: { "sec-websocket-key": "key" } };

    const api = acceptWebSocketUpgrade(request, socket);
    api.sendJson({ type: "hello", value: 1 });

    const jsonFrame = socket.writes[1];
    expect(jsonFrame[0]).toBe(0x81); // text
    const expected = JSON.stringify({ type: "hello", value: 1 });
    expect(jsonFrame.subarray(2).toString("utf8")).toBe(expected);
  });

  it("close() sends a close frame, ends the socket, and notifies onClose exactly once", () => {
    const socket = new MockSocket();
    const request = { headers: { "sec-websocket-key": "key" } };

    const api = acceptWebSocketUpgrade(request, socket);
    const onClose = vi.fn();
    api.onClose(onClose);

    api.close();
    api.close(); // idempotent

    expect(socket.ended).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);

    // After close(), sendJson is a no-op (sendFrame guards on `closed`).
    const writesAfter = socket.writes.length;
    api.sendJson({ ignored: true });
    expect(socket.writes.length).toBe(writesAfter);
  });

  it("socket 'close' / 'end' events trigger the onClose listener", () => {
    const socket = new MockSocket();
    const request = { headers: { "sec-websocket-key": "key" } };

    const api = acceptWebSocketUpgrade(request, socket);
    const onClose = vi.fn();
    api.onClose(onClose);

    socket.emit("end");
    expect(onClose).toHaveBeenCalledTimes(1);

    // Duplicate close is a no-op.
    socket.emit("close");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("socket 'error' events fan out to onError listeners and then close", () => {
    const socket = new MockSocket();
    const request = { headers: { "sec-websocket-key": "key" } };

    const api = acceptWebSocketUpgrade(request, socket);
    const onError = vi.fn();
    const onClose = vi.fn();
    api.onError(onError);
    api.onClose(onClose);

    const err = new Error("boom");
    socket.emit("error", err);

    expect(onError).toHaveBeenCalledWith(err);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("onText/onClose/onError return an unsubscribe function", () => {
    const socket = new MockSocket();
    const request = { headers: { "sec-websocket-key": "key" } };

    const api = acceptWebSocketUpgrade(request, socket);
    const onText = vi.fn();
    const off = api.onText(onText);
    off();

    socket.emit("data", maskedTextFrame("hi"));
    expect(onText).not.toHaveBeenCalled();
  });

  it("buffers partial frames across multiple 'data' chunks", () => {
    const socket = new MockSocket();
    const request = { headers: { "sec-websocket-key": "key" } };

    const api = acceptWebSocketUpgrade(request, socket);
    const onText = vi.fn();
    api.onText(onText);

    const full = maskedTextFrame("chunked");
    // Split the frame mid-payload.
    socket.emit("data", full.subarray(0, 4));
    expect(onText).not.toHaveBeenCalled();

    socket.emit("data", full.subarray(4));
    expect(onText).toHaveBeenCalledWith("chunked");
  });
});
