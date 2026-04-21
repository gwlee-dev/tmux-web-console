import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function parseTable(stdout, columns) {
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const values = line.split('\t');
      return Object.fromEntries(columns.map((column, index) => [column, values[index] ?? '']));
    });
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
    '#{session_id}\t#{session_name}\t#{session_windows}\t#{session_attached}',
  ]);

  return parseTable(stdout, ['id', 'name', 'windows', 'attached']).map((session) => ({
    ...session,
    windows: Number(session.windows),
    attached: Number(session.attached),
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

export async function getTree() {
  const [sessions, windows, panes] = await Promise.all([
    listSessions(),
    listWindows(),
    listPanes(),
  ]);

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

export async function createWindow(sessionName, name) {
  await runTmux(['new-window', '-t', sessionName, '-n', name]);
  return { ok: true, sessionName, name };
}

export async function sendCommand(targetPane, command, enter = true) {
  const args = ['send-keys', '-t', targetPane, command];
  if (enter) {
    args.push('Enter');
  }

  await runTmux(args);
  return { ok: true, targetPane, command, enter };
}

export default {
  runTmux,
  listSessions,
  listWindows,
  listPanes,
  getTree,
  createSession,
  killSession,
  createWindow,
  sendCommand,
};
