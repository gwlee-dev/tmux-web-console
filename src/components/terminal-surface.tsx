import { useEffect, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';

type PaneSnapshot = {
  targetPane: string;
  content: string;
  lineCount: number;
  historyLines: number;
  capturedAt: string;
  includesAnsi?: boolean;
};

type TerminalSurfaceProps = {
  snapshot: PaneSnapshot | null;
  selectedPaneId: string | null;
  statusMessage?: string;
  onInput: (data: string) => void;
};

function renderSnapshot(terminal: Terminal, snapshot: PaneSnapshot | null, fallbackMessage: string) {
  terminal.reset();

  if (!snapshot || !snapshot.content) {
    terminal.writeln(fallbackMessage);
    return;
  }

  terminal.write(snapshot.content);
}

export function TerminalSurface({ snapshot, selectedPaneId, statusMessage, onInput }: TerminalSurfaceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const onInputRef = useRef(onInput);

  onInputRef.current = onInput;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      lineHeight: 1.2,
      fontFamily: 'ui-monospace, SFMono-Regular, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace',
      convertEol: false,
      allowTransparency: true,
      theme: {
        background: '#050816',
        foreground: '#d4e4ff',
        cursor: '#93c5fd',
        cursorAccent: '#050816',
        selectionBackground: '#1d4ed8aa',
        black: '#0b1020',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e5eefc',
        brightBlack: '#334155',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fde047',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#f8fbff',
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    fitAddon.fit();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(container);

    const disposable = terminal.onData((data) => {
      onInputRef.current(data);
    });

    return () => {
      disposable.dispose();
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) {
      return;
    }

    fitAddon.fit();
    renderSnapshot(terminal, snapshot, statusMessage ?? '왼쪽 목록에서 패널을 선택해주세요.');
  }, [selectedPaneId, snapshot, statusMessage]);

  return <div ref={containerRef} className="h-[34rem] w-full rounded-xl bg-[#050816] p-2" />;
}
