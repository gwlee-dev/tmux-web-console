import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { FitAddon } from '@xterm/addon-fit';
import type { SearchAddon } from '@xterm/addon-search';
import type { ITheme, Terminal } from '@xterm/xterm';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

type PaneSnapshot = {
  targetPane: string;
  content: string;
  lineCount: number;
  historyLines: number;
  capturedAt: string;
  includesAnsi?: boolean;
};

type TerminalSurfaceProps = {
  snapshot?: PaneSnapshot | null;
  selectedPaneId: string | null;
  statusMessage?: string;
  mode?: 'snapshot' | 'stream';
  themeMode?: 'light' | 'dark';
  className?: string;
  mountClassName?: string;
  onInput: (data: string) => void;
  onResize?: (size: { cols: number; rows: number }) => void;
};

export type TerminalSurfaceHandle = {
  focus: () => void;
  fit: () => { cols: number; rows: number } | null;
  findNext: (query: string) => boolean;
  findPrevious: (query: string) => boolean;
  clear: () => void;
  write: (data: string) => void;
};

function renderSnapshot(terminal: Terminal, snapshot: PaneSnapshot | null, fallbackMessage: string) {
  terminal.reset();

  if (!snapshot || !snapshot.content) {
    terminal.writeln(fallbackMessage);
    return;
  }

  terminal.write(snapshot.content);
}

export const TerminalSurface = forwardRef<TerminalSurfaceHandle, TerminalSurfaceProps>(function TerminalSurface(
  { snapshot, selectedPaneId, statusMessage, mode = 'snapshot', themeMode = 'dark', className, mountClassName, onInput, onResize },
  ref,
) {
  const isMobile = useIsMobile();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const onInputRef = useRef(onInput);
  const onResizeRef = useRef(onResize);
  const snapshotRef = useRef(snapshot);
  const statusMessageRef = useRef(statusMessage);
  const isMobileRef = useRef(isMobile);

  onInputRef.current = onInput;
  onResizeRef.current = onResize;
  snapshotRef.current = snapshot;
  statusMessageRef.current = statusMessage;
  isMobileRef.current = isMobile;

  const getTheme = (): ITheme =>
    themeMode === 'dark'
      ? {
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
        }
      : {
          background: '#f8fafc',
          foreground: '#0f172a',
          cursor: '#2563eb',
          cursorAccent: '#f8fafc',
          selectionBackground: '#bfdbfe',
          selectionForeground: '#0f172a',
          black: '#1e293b',
          red: '#dc2626',
          green: '#16a34a',
          yellow: '#ca8a04',
          blue: '#2563eb',
          magenta: '#9333ea',
          cyan: '#0891b2',
          white: '#e2e8f0',
          brightBlack: '#475569',
          brightRed: '#ef4444',
          brightGreen: '#22c55e',
          brightYellow: '#eab308',
          brightBlue: '#3b82f6',
          brightMagenta: '#a855f7',
          brightCyan: '#06b6d4',
          brightWhite: '#cbd5e1',
        };

  const runFit = () => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) {
      return null;
    }

    fitAddon.fit();
    const size = { cols: terminal.cols, rows: terminal.rows };
    onResizeRef.current?.(size);
    return size;
  };

  useImperativeHandle(ref, () => ({
    focus() {
      terminalRef.current?.focus();
    },
    fit() {
      return runFit();
    },
    findNext(query: string) {
      if (!query) {
        return false;
      }

      return searchAddonRef.current?.findNext(query) ?? false;
    },
    findPrevious(query: string) {
      if (!query) {
        return false;
      }

      return searchAddonRef.current?.findPrevious(query) ?? false;
    },
    clear() {
      terminalRef.current?.reset();
    },
    write(data: string) {
      if (!data) {
        return;
      }

      terminalRef.current?.write(data);
    },
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    let disposed = false;
    let cleanup = () => {};

    const bootTerminal = async () => {
      const [{ FitAddon }, { SearchAddon }, { Terminal }] = await Promise.all([
        import('@xterm/addon-fit'),
        import('@xterm/addon-search'),
        import('@xterm/xterm'),
      ]);

      const fontFaceSet = document.fonts;
      try {
        await Promise.all([
          fontFaceSet.load('16px "Monoplex KR Nerd"'),
          fontFaceSet.ready,
        ]);
      } catch {}

      if (disposed) {
        return;
      }

      const terminal = new Terminal({
        cursorBlink: true,
        fontSize: isMobileRef.current ? 13 : 16,
        lineHeight: 1,
        letterSpacing: 0,
        // iOS/Safari 는 Monoplex 에 없는 글리프(예: ⊚ U+229A, ⬤ U+2B24)를
        // Apple Color Emoji 로 합성한다. 텍스트 프리젠테이션 심볼 폰트를
        // fallback 체인에 배치해 emoji 승격을 차단한다.
        fontFamily: '"Monoplex KR Nerd", "Apple Symbols", "Segoe UI Symbol", "Noto Sans Symbols 2", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        fontWeight: 400,
        fontWeightBold: 700,
        customGlyphs: true,
        drawBoldTextInBrightColors: false,
        convertEol: false,
        allowTransparency: true,
        scrollback: 5000,
        theme: getTheme(),
      });
      const fitAddon = new FitAddon();
      const searchAddon = new SearchAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(searchAddon);
      terminal.open(container);
      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      searchAddonRef.current = searchAddon;
      runFit();
      renderSnapshot(terminal, snapshotRef.current ?? null, statusMessageRef.current ?? '왼쪽 목록에서 패널을 선택해주세요.');

      const refreshForFontLoad = () => {
        terminal.clearTextureAtlas();
        runFit();
      };
      fontFaceSet.addEventListener?.('loadingdone', refreshForFontLoad);

      const resizeObserver = new ResizeObserver(() => {
        runFit();
      });
      resizeObserver.observe(container);

      // iOS / Android IME 처리: xterm 자체 textarea 는 composition 중에도 input
      // 이벤트를 fire 하며, iOS Safari 에서는 compositionstart 가 input 이벤트보다
      // 늦게 fire 되는 경우가 있어 '자모 분리 상태의 data' 가 PTY 로 흘러간다.
      //
      // 해결: helper textarea 의 input 이벤트를 CAPTURE phase 에서 가로채
      // composing 동안의 emit 을 차단한다. xterm 의 자체 input handler 는 bubble
      // phase 에서 동작하므로 stopImmediatePropagation 으로 확실히 차단한다.
      // compositionend 의 event.data 만 한 번에 send.
      let composing = false;
      let pendingCommit: string | null = null;
      const helperTextarea = container.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');

      const handleCompositionStart = () => {
        composing = true;
      };

      const handleCompositionEnd = (event: CompositionEvent) => {
        composing = false;
        pendingCommit = event.data ?? null;
        // 현재 이벤트 루프가 끝난 뒤 textarea 를 비우고 commit 을 전송한다.
        // 일부 iOS 빌드는 compositionend 이후에도 input 이벤트를 한 번 더 발송하는데,
        // 그 이벤트를 capture 단계에서 흡수해 xterm onData 가 중복 전송하지 않도록 한다.
        queueMicrotask(() => {
          if (helperTextarea) {
            helperTextarea.value = '';
          }
          if (pendingCommit) {
            onInputRef.current(pendingCommit);
            pendingCommit = null;
          }
        });
      };

      const handleInputCapture = (event: Event) => {
        // composition 중이거나 compositionend 직후 남은 tail input 은 무시.
        if (composing || pendingCommit !== null) {
          event.stopImmediatePropagation();
          event.preventDefault?.();
        }
      };

      helperTextarea?.addEventListener('compositionstart', handleCompositionStart);
      helperTextarea?.addEventListener('compositionend', handleCompositionEnd);
      helperTextarea?.addEventListener('input', handleInputCapture, true);
      helperTextarea?.addEventListener('beforeinput', handleInputCapture, true);

      const inputDisposable = terminal.onData((data) => {
        if (composing || pendingCommit !== null) {
          return;
        }
        onInputRef.current(data);
      });

      cleanup = () => {
        fontFaceSet.removeEventListener?.('loadingdone', refreshForFontLoad);
        helperTextarea?.removeEventListener('compositionstart', handleCompositionStart);
        helperTextarea?.removeEventListener('compositionend', handleCompositionEnd);
        helperTextarea?.removeEventListener('input', handleInputCapture, true);
        helperTextarea?.removeEventListener('beforeinput', handleInputCapture, true);
        inputDisposable.dispose();
        resizeObserver.disconnect();
        terminal.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
        searchAddonRef.current = null;
      };
    };

    void bootTerminal();

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    if (mode !== 'snapshot') {
      return;
    }

    runFit();
    renderSnapshot(terminal, snapshot ?? null, statusMessage ?? '왼쪽 목록에서 패널을 선택해주세요.');
    terminal.focus();
  }, [mode, selectedPaneId, snapshot, statusMessage]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || mode !== 'stream') {
      return;
    }

    terminal.reset();
    if (statusMessage) {
      terminal.writeln(statusMessage);
    }
    terminal.focus();
  }, [mode, selectedPaneId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.options.theme = getTheme();
    terminal.refresh(0, terminal.rows - 1);
  }, [themeMode]);

  return (
    <div
      className={cn(
        'terminal-surface h-full min-h-[28rem] w-full overflow-hidden rounded-xl p-0',
        themeMode === 'dark' ? 'bg-[#050816]' : 'bg-slate-50',
        className,
      )}
    >
      <div ref={containerRef} className={cn('h-full w-full', mountClassName)} />
    </div>
  );
});
