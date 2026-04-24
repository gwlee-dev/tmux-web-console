import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/* v8 ignore start -- filesystem + node-pty native dependency, covered via integration only */
function ensureNodePtySpawnHelperExecutable() {
  const entryPath = require.resolve('node-pty');
  const packageDir = path.dirname(path.dirname(entryPath));
  const helperPath = path.join(packageDir, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper');

  if (!fs.existsSync(helperPath)) {
    return;
  }

  const stat = fs.statSync(helperPath);
  const nextMode = stat.mode | 0o111;
  if ((stat.mode & 0o111) !== 0o111) {
    fs.chmodSync(helperPath, nextMode);
  }
}

function getNodePtyModule() {
  ensureNodePtySpawnHelperExecutable();
  return require('node-pty');
}
/* v8 ignore stop */

export function buildPtyEnv() {
  const env = {
    ...process.env,
    TERM: 'xterm-256color',
  };

  delete env.TMUX;
  delete env.TMUX_PANE;

  return env;
}

/* v8 ignore start -- filesystem probing, exercised only in Node runtime */
function resolveTmuxBinary() {
  if (process.env.TMUX_BINARY) {
    return process.env.TMUX_BINARY;
  }

  const homebrewTmux = '/opt/homebrew/bin/tmux';
  if (fs.existsSync(homebrewTmux)) {
    return homebrewTmux;
  }

  return 'tmux';
}
/* v8 ignore stop */

/**
 * XOR a masked WebSocket payload with its 4-byte mask.
 * Cycles the mask index with `index % 4`, so any mask length is tolerated
 * but RFC 6455 only mandates 4-byte masks.
 */
export function unmaskPayload(maskedPayload, mask) {
  const decoded = Buffer.allocUnsafe(maskedPayload.length);
  for (let index = 0; index < maskedPayload.length; index += 1) {
    decoded[index] = maskedPayload[index] ^ mask[index % 4];
  }
  return decoded;
}

/**
 * Parse a single WebSocket frame out of a buffer.
 * Returns `null` when the buffer does not yet contain a complete frame, so the
 * caller can accumulate more bytes and retry. On success returns the decoded
 * frame (opcode + already-unmasked payload) and the remaining bytes that
 * belong to a subsequent frame.
 *
 * The while-loop across multiple frames and the opcode dispatch (0x1 text /
 * 0x8 close / 0x9 ping) live in the caller — this helper is pure byte parsing.
 */
export function parseWebSocketFrame(buffer) {
  if (buffer.length < 2) {
    return null;
  }

  const first = buffer[0];
  const second = buffer[1];
  const opcode = first & 0x0f;
  const isMasked = (second & 0x80) !== 0;

  let payloadLength = second & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) {
      return null;
    }
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) {
      return null;
    }
    payloadLength = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }

  const maskLength = isMasked ? 4 : 0;
  const frameLength = offset + maskLength + payloadLength;
  if (buffer.length < frameLength) {
    return null;
  }

  let payload = buffer.subarray(offset + maskLength, frameLength);
  if (isMasked) {
    const mask = buffer.subarray(offset, offset + 4);
    payload = unmaskPayload(payload, mask);
  }

  return {
    frame: { opcode, payload },
    remaining: buffer.subarray(frameLength),
  };
}

export function encodeFrame(opcode, payload = Buffer.alloc(0)) {
  const length = payload.length;

  if (length < 126) {
    return Buffer.concat([Buffer.from([0x80 | opcode, length]), payload]);
  }

  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }

  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payload]);
}

export function createWebSocketAcceptValue(key) {
  return createHash('sha1').update(`${key}${WEBSOCKET_GUID}`).digest('base64');
}

export function createHttpErrorResponse(statusCode, message) {
  const reasonPhrase =
    statusCode === 400 ? 'Bad Request' : statusCode === 401 ? 'Unauthorized' : statusCode === 404 ? 'Not Found' : 'Internal Server Error';
  const body = JSON.stringify({ error: message });

  return [
    `HTTP/1.1 ${statusCode} ${reasonPhrase}`,
    'Content-Type: application/json; charset=utf-8',
    `Content-Length: ${Buffer.byteLength(body)}`,
    'Connection: close',
    '',
    body,
  ].join('\r\n');
}

export function rejectWebSocketUpgrade(socket, statusCode, message) {
  socket.write(createHttpErrorResponse(statusCode, message));
  socket.destroy();
}

export function acceptWebSocketUpgrade(request, socket, head = Buffer.alloc(0)) {
  const key = request.headers['sec-websocket-key'];
  if (!key) {
    rejectWebSocketUpgrade(socket, 400, 'Missing Sec-WebSocket-Key header');
    return null;
  }

  socket.write(
    [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${createWebSocketAcceptValue(key)}`,
      '',
      '',
    ].join('\r\n'),
  );

  if (head.length > 0) {
    socket.unshift(head);
  }

  let closed = false;
  let buffered = Buffer.alloc(0);
  const textListeners = new Set();
  const closeListeners = new Set();
  const errorListeners = new Set();

  const notifyClose = () => {
    if (closed) {
      return;
    }

    closed = true;
    for (const listener of closeListeners) {
      listener();
    }
  };

  const sendFrame = (opcode, payload) => {
    if (closed || socket.destroyed) {
      return;
    }

    socket.write(encodeFrame(opcode, payload));
  };

  const close = () => {
    if (closed) {
      return;
    }

    sendFrame(0x8);
    socket.end();
    notifyClose();
  };

  const parseBufferedFrames = () => {
    while (true) {
      const result = parseWebSocketFrame(buffered);
      if (!result) {
        return;
      }

      buffered = result.remaining;
      const { opcode, payload } = result.frame;

      if (opcode === 0x8) {
        close();
        return;
      }

      if (opcode === 0x9) {
        sendFrame(0xA, payload);
        continue;
      }

      if (opcode === 0x1) {
        const message = payload.toString('utf8');
        for (const listener of textListeners) {
          listener(message);
        }
      }
    }
  };

  socket.on('data', (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    parseBufferedFrames();
  });

  socket.on('close', notifyClose);
  socket.on('end', notifyClose);
  socket.on('error', (error) => {
    for (const listener of errorListeners) {
      listener(error);
    }
    notifyClose();
  });

  return {
    sendJson(payload) {
      sendFrame(0x1, Buffer.from(JSON.stringify(payload)));
    },
    close,
    onText(listener) {
      textListeners.add(listener);
      return () => textListeners.delete(listener);
    },
    onClose(listener) {
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
    onError(listener) {
      errorListeners.add(listener);
      return () => errorListeners.delete(listener);
    },
  };
}

/* v8 ignore start -- node-pty native dependency, covered only via integration runtime */
export async function createTmuxPtyBridge(tmuxClient, { paneId, cols, rows }) {
  const metadata = await tmuxClient.preparePanePtyTarget(paneId);
  const normalizedCols = normalizePositiveInteger(cols, 120);
  const normalizedRows = normalizePositiveInteger(rows, 32);
  const pty = getNodePtyModule();
  const terminal = pty.spawn(resolveTmuxBinary(), [
    'attach-session',
    '-t',
    metadata.sessionName,
    ';',
    'select-window',
    '-t',
    metadata.windowId,
    ';',
    'select-pane',
    '-t',
    metadata.paneId,
  ], {
    name: 'xterm-256color',
    cols: normalizedCols,
    rows: normalizedRows,
    cwd: metadata.currentPath || process.cwd(),
    env: buildPtyEnv(),
  });

  let disposed = false;
  const dataListeners = new Set();
  const exitListeners = new Set();

  terminal.onData((data) => {
    for (const listener of dataListeners) {
      listener(data);
    }
  });

  terminal.onExit(({ exitCode, signal }) => {
    disposed = true;
    for (const listener of exitListeners) {
      listener({ exitCode, signal });
    }
  });

  return {
    metadata,
    write(data) {
      if (disposed || typeof data !== 'string' || data.length === 0) {
        return;
      }

      terminal.write(data);
    },
    resize(nextCols, nextRows) {
      if (disposed) {
        return;
      }

      terminal.resize(normalizePositiveInteger(nextCols, normalizedCols), normalizePositiveInteger(nextRows, normalizedRows));
    },
    destroy() {
      if (disposed) {
        return;
      }

      disposed = true;
      terminal.kill();
    },
    onData(listener) {
      dataListeners.add(listener);
      return () => dataListeners.delete(listener);
    },
    onExit(listener) {
      exitListeners.add(listener);
      return () => exitListeners.delete(listener);
    },
  };
}
/* v8 ignore stop */
