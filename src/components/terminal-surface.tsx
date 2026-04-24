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

      // iOS (iPad/iPhone/iPod + iPadOS) 에서는 soft keyboard IME 를 완전히
      // 우리가 관리한다. 데스크톱은 xterm 기본 CompositionHelper 경로를 그대로
      // 사용하므로 이 블록 전체를 건드리지 않는다.
      //
      // 핵심 아이디어: 한글 syllable 조합 중에는 PTY 왕복을 하지 않고
      // xterm 버퍼에 직접 write 하여 로컬 에코 — 사용자는 타이핑 즉시 반응을
      // 본다. syllable 이 확정되는 시점 (비-한글 입력, Enter, 300ms idle) 에만
      // PTY 로 commit 하고, PTY 가 돌려주는 echo 바이트가 xterm 을 덮어
      // 화면이 올바르게 수렴하도록 한다.
      const isIOS = typeof navigator !== 'undefined' && (
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
      );

      const handleIOSKeyEvent = (event: Event) => {
        // iOS 는 textarea 가 비어있을 때 Backspace 키를 눌러도 `input` 이벤트
        // 를 fire 하지 않는다 (Enter 는 insertLineBreak input 이벤트로 여전히
        // 온다). 따라서 Backspace 만 keydown 에서 직접 PTY 로 보내 "기존 PTY
        // 출력이 안 지워지는" 이슈를 해결하고, Enter 는 input handler 에 맡겨
        // 중복 송신을 피한다.
        if (event.type === 'keydown') {
          const ke = event as KeyboardEvent;
          if (ke.key === 'Backspace' && (helperTextarea?.value ?? '') === '') {
            onInputRef.current('\x7f');
          }
        }
        event.stopImmediatePropagation();
      };

      // iOS Hangul 로컬 에코 — 음절 경계 안에서는 local echo, 단어 경계에서만
      // PTY 왕복 발생. 이전 구현은 매 음절 전환에서 commit 했는데, commit 의
      // eraseLocal 이 xterm 커서를 뒤로 보내고 이어 local write 가 새 음절을
      // 같은 위치에 쓰면, 뒤늦게 PTY echo 가 도착해 새 음절 다음에 이전 음절을
      // append 해서 "이런" → "런이" 같은 꼬임이 발생했다.
      //
      // 새 규칙:
      //   - buffer: 확정됐지만 아직 PTY 로 보내지 않은 음절 누적 문자열
      //     (여전히 화면에 그려져 있음)
      //   - current: 현재 조합 중인 한 음절 (local 에만 표시)
      //   - localWidth: buffer + current 가 차지한 terminal cell 수
      //   - commitAll() 은 local 전체를 지우고 buffer+current 를 한 번에 PTY
      //     로 보냄. PTY echo 가 돌아와 xterm 이 같은 위치에 재작도 → 수렴.
      //   - commitAll 은 공백/Enter/Delete-forward 또는 300ms idle 에서만 호출.
      // iOS 한글 입력 전달 — 로컬 에코 없이 input 이벤트를 그대로 PTY 로 전달.
      //
      // 과거에 currentSyllable 를 xterm 에 직접 write 해 PTY 왕복을 숨기려
      // 했으나, 서버에서 돌아오는 echo 바이트가 로컬 write 와 async 하게
      // 부딪혀 "이런식식으로" 처럼 커서가 엇갈리는 race condition 을 만들었다.
      // 로컬 에코를 제거하면 PTY echo 만이 렌더링 근원이므로 상태가 수렴한다.
      // 플리커는 동일하게 남지만 입력 결과가 신뢰 가능하다.
      //
      // iOS 의 한글 조합은 keydown(keyCode=0) / keypress 는 capture 단계에서
      // 차단하고, input 의 inputType 만 번역해 PTY 로 보낸다. 음절 업데이트는
      // deleteContentBackward + insertText 쌍으로 들어오므로 \x7f + 새 syllable
      // 바이트가 그대로 shell 에 전달된다.
      const handleIOSInput = (event: Event) => {
        const ie = event as InputEvent;
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
          ie.stopImmediatePropagation();
        }
      };

      // helper textarea 에 직접 attach 하면 DOM target phase 에서 xterm 의
      // 기존 listener 뒤로 줄을 서서 `stopImmediatePropagation` 이 소용없다
      // (xterm 이 먼저 emit). 상위 container 의 CAPTURE phase 에 등록하면
      // target phase 로 내려가기 전에 우리 listener 가 실행된다.
      if (isIOS) {
        container.addEventListener('keydown', handleIOSKeyEvent, true);
        container.addEventListener('keypress', handleIOSKeyEvent, true);
        container.addEventListener('input', handleIOSInput, true);
      }

      const inputDisposable = terminal.onData((data) => {
        onInputRef.current(data);
      });

      cleanup = () => {
        fontFaceSet.removeEventListener?.('loadingdone', refreshForFontLoad);
        if (isIOS) {
          container.removeEventListener('keydown', handleIOSKeyEvent, true);
          container.removeEventListener('keypress', handleIOSKeyEvent, true);
          container.removeEventListener('input', handleIOSInput, true);
        }
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
