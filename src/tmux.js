import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SPECIAL_SEQUENCE_MAP = new Map([
  ['\u001b[A', 'Up'],
  ['\u001b[B', 'Down'],
  ['\u001b[C', 'Right'],
  ['\u001b[D', 'Left'],
  ['\u001b[H', 'Home'],
  ['\u001b[F', 'End'],
  ['\u001b[2~', 'IC'],
  ['\u001b[3~', 'DC'],
  ['\u001b[5~', 'PageUp'],
  ['\u001b[6~', 'PageDown'],
  ['\u001bOP', 'F1'],
  ['\u001bOQ', 'F2'],
  ['\u001bOR', 'F3'],
  ['\u001bOS', 'F4'],
]);

const CONTROL_CHARACTER_MAP = new Map([
  ['\r', 'Enter'],
  ['\n', 'Enter'],
  ['\t', 'Tab'],
  ['\u0003', 'C-c'],
  ['\u0004', 'C-d'],
  ['\u0005', 'C-e'],
  ['\u0006', 'C-f'],
  ['\u0001', 'C-a'],
  ['\u0002', 'C-b'],
  ['\u000b', 'C-k'],
  ['\u000c', 'C-l'],
  ['\u000e', 'C-n'],
  ['\u0010', 'C-p'],
  ['\u0015', 'C-u'],
  ['\u001a', 'C-z'],
  ['\u007f', 'BSpace'],
]);

export function parseTable(stdout, columns) {
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const values = line.split('\t');
      return Object.fromEntries(columns.map((column, index) => [column, values[index] ?? '']));
    });
}

export function tokenizeInput(input) {
  const tokens = [];
  let literalBuffer = '';
  let index = 0;

  const flushLiteral = () => {
    if (literalBuffer.length > 0) {
      tokens.push({ type: 'literal', value: literalBuffer });
      literalBuffer = '';
    }
  };

  const orderedSequences = [...SPECIAL_SEQUENCE_MAP.entries()].sort((left, right) => right[0].length - left[0].length);

  while (index < input.length) {
    const rest = input.slice(index);
    let matchedSequence = false;

    for (const [sequence, keyName] of orderedSequences) {
      if (rest.startsWith(sequence)) {
        flushLiteral();
        tokens.push({ type: 'key', value: keyName });
        index += sequence.length;
        matchedSequence = true;
        break;
      }
    }

    if (matchedSequence) {
      continue;
    }

    const currentCharacter = input[index];
    const controlKey = CONTROL_CHARACTER_MAP.get(currentCharacter);
    if (controlKey) {
      flushLiteral();
      tokens.push({ type: 'key', value: controlKey });
      index += 1;
      continue;
    }

    if (currentCharacter === '\u001b') {
      flushLiteral();
      tokens.push({ type: 'key', value: 'Escape' });
      index += 1;
      continue;
    }

    literalBuffer += currentCharacter;
    index += 1;
  }

  flushLiteral();
  return tokens;
}

export async function runTmux(args) {
  try {
    const { stdout } = await execFileAsync('tmux', args, {
      env: process.env,
      maxBuffer: 1024 * 1024,
    });

    return stdout;
  } catch (error) {
    const message = error.stderr?.trim() || error.message || 'tmux command failed';
    const wrapped = new Error(message);
    wrapped.code = error.code;
    wrapped.exitCode = error.code;
    wrapped.details = { args };
    throw wrapped;
  }
}

export async function listSessions() {
  const stdout = await runTmux([
    'list-sessions',
    '-F',
    '#{session_id}\t#{session_name}\t#{session_windows}\t#{session_attached}\t#{session_created}',
  ]);

  return parseTable(stdout, ['id', 'name', 'windows', 'attached', 'created']).map((session) => ({
    ...session,
    windows: Number(session.windows),
    attached: Number(session.attached),
    created: Number(session.created),
  }));
}

export async function listWindows() {
  const stdout = await runTmux([
    'list-windows',
    '-a',
    '-F',
    '#{session_name}\t#{window_id}\t#{window_index}\t#{window_name}\t#{window_active}\t#{window_panes}',
  ]);

  return parseTable(stdout, ['sessionName', 'id', 'index', 'name', 'active', 'panes']).map((window) => ({
    ...window,
    index: Number(window.index),
    active: window.active === '1',
    panes: Number(window.panes),
  }));
}

export async function listPanes() {
  const stdout = await runTmux([
    'list-panes',
    '-a',
    '-F',
    '#{session_name}\t#{window_id}\t#{pane_id}\t#{pane_index}\t#{pane_active}\t#{pane_title}\t#{pane_current_command}\t#{pane_current_path}',
  ]);

  return parseTable(stdout, [
    'sessionName',
    'windowId',
    'id',
    'index',
    'active',
    'title',
    'currentCommand',
    'currentPath',
  ]).map((pane) => ({
    ...pane,
    index: Number(pane.index),
    active: pane.active === '1',
  }));
}

export async function capturePane(targetPane, historyLines = 200, { includeAnsi = true } = {}) {
  const normalizedHistory = Number.isInteger(historyLines) && historyLines > 0 ? historyLines : 200;
  const args = ['capture-pane', '-p', '-J', '-t', targetPane, '-S', `-${normalizedHistory}`];

  if (includeAnsi) {
    args.splice(2, 0, '-e');
  }

  const content = await runTmux(args);
  const normalizedContent = content.replace(/\n$/, '');
  const lineCount = normalizedContent.length === 0 ? 0 : normalizedContent.split('\n').length;

  return {
    targetPane,
    content: normalizedContent,
    lineCount,
    historyLines: normalizedHistory,
    capturedAt: new Date().toISOString(),
    includesAnsi: includeAnsi,
  };
}

export async function getTree() {
  const [sessions, windows, panes] = await Promise.all([listSessions(), listWindows(), listPanes()]);

  const panesByWindow = new Map();
  for (const pane of panes) {
    const bucket = panesByWindow.get(pane.windowId) ?? [];
    bucket.push(pane);
    panesByWindow.set(pane.windowId, bucket);
  }

  const windowsBySession = new Map();
  for (const window of windows) {
    const bucket = windowsBySession.get(window.sessionName) ?? [];
    bucket.push({
      ...window,
      panes: panesByWindow.get(window.id) ?? [],
    });
    windowsBySession.set(window.sessionName, bucket);
  }

  return sessions.map((session) => ({
    ...session,
    windows: windowsBySession.get(session.name) ?? [],
  }));
}

export async function createSession(name) {
  await runTmux(['new-session', '-d', '-s', name]);
  return { ok: true, name };
}

export async function killSession(name) {
  await runTmux(['kill-session', '-t', name]);
  return { ok: true, name };
}

export async function renameSession(name, nextName) {
  await runTmux(['rename-session', '-t', name, nextName]);
  return { ok: true, name, nextName };
}

export async function createWindow(sessionName, name) {
  await runTmux(['new-window', '-t', sessionName, '-n', name]);
  return { ok: true, sessionName, name };
}

export async function killWindow(windowId) {
  await runTmux(['kill-window', '-t', windowId]);
  return { ok: true, windowId };
}

export async function getPaneGeometry(targetPane) {
  const stdout = await runTmux([
    'display-message',
    '-p',
    '-t',
    targetPane,
    '#{session_name}\t#{window_id}\t#{window_name}\t#{pane_width}\t#{pane_height}',
  ]);

  const [sessionName = '', windowId = '', windowName = '', width = '0', height = '0'] = stdout.trim().split('\t');
  return {
    sessionName,
    windowId,
    windowName,
    width: Number(width),
    height: Number(height),
  };
}

export async function getPanePtyTarget(targetPane) {
  const stdout = await runTmux([
    'display-message',
    '-p',
    '-t',
    targetPane,
    '#{pane_id}\t#{session_name}\t#{window_id}\t#{window_name}\t#{pane_current_path}\t#{pane_title}',
  ]);

  const [paneId = '', sessionName = '', windowId = '', windowName = '', currentPath = '', paneTitle = ''] = stdout.trim().split('\t');

  return {
    paneId,
    sessionName,
    windowId,
    windowName,
    currentPath,
    paneTitle,
  };
}

export async function preparePanePtyTarget(targetPane) {
  const target = await getPanePtyTarget(targetPane);

  try {
    await runTmux(['select-window', '-t', target.windowId]);
  } catch {}

  try {
    await runTmux(['select-pane', '-t', targetPane]);
  } catch {}

  return target;
}

export async function sendCommand(targetPane, command, enter = true) {
  const args = ['send-keys', '-t', targetPane, command];
  if (enter) {
    args.push('Enter');
  }

  await runTmux(args);
  return { ok: true, targetPane, command, enter };
}


export async function resizePane(targetPane, cols, rows) {
  if (!Number.isInteger(cols) || cols <= 0 || !Number.isInteger(rows) || rows <= 0) {
    const error = new Error('cols and rows must be positive integers');
    error.statusCode = 400;
    throw error;
  }

  const geometry = await getPaneGeometry(targetPane);

  try {
    await runTmux(['setw', '-t', geometry.windowId, 'window-size', 'manual']);
  } catch {}

  try {
    await runTmux(['resize-window', '-t', geometry.windowId, '-x', String(cols), '-y', String(rows)]);
  } catch {}

  await runTmux(['resize-pane', '-t', targetPane, '-x', String(cols), '-y', String(rows)]);

  const updatedGeometry = await getPaneGeometry(targetPane);
  return {
    ok: true,
    targetPane,
    requestedCols: cols,
    requestedRows: rows,
    appliedCols: updatedGeometry.width,
    appliedRows: updatedGeometry.height,
    windowId: updatedGeometry.windowId,
    sessionName: updatedGeometry.sessionName,
  };
}

export async function sendInput(targetPane, input) {
  if (typeof input !== 'string' || input.length === 0) {
    const error = new Error('input is required');
    error.statusCode = 400;
    throw error;
  }

  const tokens = tokenizeInput(input);
  for (const token of tokens) {
    if (token.type === 'literal') {
      await runTmux(['send-keys', '-l', '-t', targetPane, token.value]);
      continue;
    }

    await runTmux(['send-keys', '-t', targetPane, token.value]);
  }

  return {
    ok: true,
    targetPane,
    inputLength: input.length,
  };
}

export default {
  runTmux,
  listSessions,
  listWindows,
  listPanes,
  capturePane,
  getTree,
  createSession,
  killSession,
  renameSession,
  createWindow,
  killWindow,
  getPaneGeometry,
  getPanePtyTarget,
  preparePanePtyTarget,
  sendCommand,
  sendInput,
  resizePane,
  parseTable,
  tokenizeInput,
};
