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

      // iOS soft-keyboard 한글 입력 처리.
      //
      // 진단 (public/ime-debug.html + iOS 18.7 Safari Web Inspector):
      //   - iOS 한글 키보드는 `compositionstart` / `compositionupdate` /
      //     `compositionend` 를 **전혀 발생시키지 않는다**.
      //   - `keydown` 은 키 하나당 fire 되며 `key` 에 **raw jamo** (ㅇ/ㅏ/ㄴ…),
      //     `keyCode` 는 항상 `0`.
      //   - IME 조합은 OS 레벨에서 수행되어 `beforeinput` + `input` 이벤트로
      //     textarea 에 반영됨:
      //         ㅇ:  insertText data=ㅇ     val=ㅇ
      //         ㅏ:  deleteContentBackward  → insertText data=아   val=아
      //         ㄴ:  deleteContentBackward  → insertText data=안   val=안
      //         … (다음 글자부터 새 음절)
      //
      // xterm.js 는 `keydown` 으로 emit 하므로 iOS soft keyboard 에서는
      // 조합 전 jamo 가 PTY 로 바로 흘러가 "ㅇㅏㄴ" 처럼 보인다. 또한
      // composition event 가 안 뜨니 CompositionHelper 경로도 타지 않는다.
      //
      // 해결:
      //   1. helper textarea 에서 `keydown.keyCode === 0` 이벤트를 capture
      //      phase 에서 `stopImmediatePropagation` → xterm 의 emit 경로 차단.
      //      외부 BT 키보드는 실제 keyCode 를 보고하므로 이 차단에 영향받지 않음.
      //   2. `input` 이벤트를 직접 구독해 inputType 별로 PTY 에 emit.
      //
      // macOS/Linux 데스크톱은 keyCode !== 0 이고 compositionstart/end 가 정상
      // 동작하므로 xterm 기본 경로 그대로 사용.
      const helperTextarea = container.querySelector<HTMLTextAreaElement>(
        '.xterm-helper-textarea',
      );

      const debugIme = typeof window !== 'undefined' && window.localStorage?.getItem('debug_ime') === '1';
      const imeLog = (msg: string, detail?: unknown) => {
        if (!debugIme) return;
        console.log(`[ime ${new Date().toISOString().slice(11, 23)}]`, msg, detail ?? '');
      };

      const handleSoftKeyboardKeydown = (event: Event) => {
        const ke = event as KeyboardEvent;
        imeLog(`keydown key=${ke.key} keyCode=${ke.keyCode} target=${(ke.target as Element | null)?.tagName}`);
        if (ke.keyCode === 0) {
          ke.stopImmediatePropagation();
          imeLog('keydown BLOCKED');
        }
      };

      const handleSoftKeyboardInput = (event: Event) => {
        const ie = event as InputEvent;
        imeLog(`input type=${ie.inputType} data=${JSON.stringify(ie.data)}`);
        let handled = true;
        switch (ie.inputType) {
          case 'insertText':
            if (ie.data) {
              onInputRef.current(ie.data);
            }
            break;
          case 'deleteContentBackward':
            onInputRef.current('\x7f');
            break;
          case 'insertLineBreak':
          case 'insertParagraph':
            onInputRef.current('\r');
            // 엔터 후 textarea 를 비워 iOS IME 가 다음 composition 을
            // clean state 에서 시작하도록 한다.
            queueMicrotask(() => {
              if (helperTextarea) helperTextarea.value = '';
            });
            break;
          case 'deleteContentForward':
            onInputRef.current('\x1b[3~');
            break;
          default:
            handled = false;
        }
        if (handled) {
          // xterm 의 _inputEvent 가 동일한 event 를 capture phase 로 구독
          // (CoreBrowserTerminal.ts:384) 하고 insertText 의 data 를 그대로
          // triggerDataEvent 로 emit 하기 때문에, container capture 단계에서
          // 전파를 차단해 중복 송신을 막는다.
          ie.stopImmediatePropagation();
        }
      };

      // helper textarea 에 직접 attach 하면 DOM target phase 에서 xterm 의
      // 기존 listener 뒤로 줄을 서서 `stopImmediatePropagation` 이 소용없다
      // (xterm 이 먼저 emit). 상위 container 의 CAPTURE phase 에 등록하면
      // target phase 로 내려가기 전에 우리 listener 가 실행된다.
      container.addEventListener('keydown', handleSoftKeyboardKeydown, true);
      container.addEventListener('input', handleSoftKeyboardInput, true);

      const inputDisposable = terminal.onData((data) => {
        onInputRef.current(data);
      });

      cleanup = () => {
        fontFaceSet.removeEventListener?.('loadingdone', refreshForFontLoad);
        container.removeEventListener('keydown', handleSoftKeyboardKeydown, true);
        container.removeEventListener('input', handleSoftKeyboardInput, true);
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
