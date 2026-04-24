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
  debug?: boolean;
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
  { snapshot, selectedPaneId, statusMessage, mode = 'snapshot', themeMode = 'dark', className, mountClassName, onInput, onResize, debug = false },
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

      // 터치 디바이스: 한 손가락 swipe 를 wheel 이벤트로 합성한다.
      // tmux 의 mouse mode 가 켜진 경우 wheel 이벤트가 그대로 PTY 에 SGR
      // mouse sequence 로 전송되어 scrollback / less / vim 모두에서 자연스럽게
      // 동작한다. mouse mode 가 꺼져 있어도 xterm.js 의 viewport scroll 이
      // wheel 이벤트를 받아 자체 스크롤백을 움직여준다.
      //
      // 주의:
      //   - listener 는 container 전체에 capture 단계로 등록한다. .xterm-screen
      //     아래 helper textarea / canvas overlay 가 touch 를 가로채는 것을
      //     상위에서 먼저 잡기 위함.
      //   - touch-action: none 도 container 전체에 적용해 iOS Safari 가
      //     visual viewport 를 스크롤하는 기본 동작을 차단.
      const debugScroll = debug;
      let debugOverlay: HTMLDivElement | null = null;
      const overlayLines: string[] = [];
      if (debugScroll) {
        debugOverlay = document.createElement('div');
        debugOverlay.style.cssText = [
          'position:fixed',
          'top:8px',
          'left:8px',
          'right:8px',
          'max-height:40vh',
          'overflow:hidden',
          'pointer-events:none',
          'z-index:99999',
          'background:rgba(0,0,0,0.7)',
          'color:#7fffa5',
          'font:11px/1.3 ui-monospace,monospace',
          'padding:6px 8px',
          'border-radius:6px',
          'white-space:pre-wrap',
          'word-break:break-all',
        ].join(';');
        document.body.appendChild(debugOverlay);
      }
      const sLog = (msg: string) => {
        if (!debugScroll) return;
        const line = `[${new Date().toISOString().slice(14, 23)}] ${msg}`;
        console.log('[scroll]', line);
        overlayLines.push(line);
        if (overlayLines.length > 25) overlayLines.shift();
        if (debugOverlay) debugOverlay.textContent = overlayLines.join('\n');
      };

      const dispatchWheel = (deltaX: number, deltaY: number) => {
        if (deltaX === 0 && deltaY === 0) return;
        const xtermEl = terminal.element;
        const cellHeight =
          (terminal as unknown as {
            _core?: { _renderService?: { dimensions?: { css?: { cell?: { height?: number } } } } };
          })._core?._renderService?.dimensions?.css?.cell?.height ?? 16;
        // cell 의 약 1.5 배가 쌓여야 1 line 으로 emit. iOS 터치 delta 가
        // 촘촘해서 cell height 기준이면 1 swipe 에 수십 줄 넘겨버림.
        const threshold = Math.max(20, cellHeight * 1.5);
        wheelAccumY += deltaY;
        wheelAccumX += deltaX;
        const linesY = (wheelAccumY > 0 ? 1 : -1) * Math.floor(Math.abs(wheelAccumY) / threshold);
        const linesX = (wheelAccumX > 0 ? 1 : -1) * Math.floor(Math.abs(wheelAccumX) / threshold);
        if (linesY !== 0) wheelAccumY -= linesY * threshold;
        if (linesX !== 0) wheelAccumX -= linesX * threshold;
        if (linesY === 0 && linesX === 0) return;

        const mouseEventsActive = xtermEl?.classList.contains('enable-mouse-events');
        sLog(`dispatchWheel dy=${deltaY.toFixed(1)} acc=${wheelAccumY.toFixed(1)} threshold=${threshold.toFixed(1)} lines=${linesY} mouseActive=${mouseEventsActive}`);

        if (mouseEventsActive && linesY !== 0) {
          // tmux mouse mode: SGR extended mouse wheel 바이트를 PTY 로 직접.
          const col = Math.max(1, Math.round((terminal.cols || 80) / 2));
          const row = Math.max(1, Math.round((terminal.rows || 24) / 2));
          const button = linesY > 0 ? 65 : 64; // 65 = wheel-down, 64 = wheel-up
          const count = Math.abs(linesY);
          for (let i = 0; i < count; i++) {
            onInputRef.current(`\x1b[<${button};${col};${row}M`);
          }
          sLog(`SGR wheel button=${button} count=${count}`);
          return;
        }

        if (linesY !== 0) {
          sLog(`scrollLines ${linesY}`);
          terminal.scrollLines(linesY);
        }
      };

      let lastTouchY: number | null = null;
      let lastTouchX: number | null = null;
      // touchmove 의 아주 작은 delta (1-2 px) 까지 1 line 으로 올리면 swipe 가
      // 과도하게 빠르다. cell height 의 60% 가 쌓일 때마다 1 line 으로 방출.
      let wheelAccumY = 0;
      let wheelAccumX = 0;

      const handleTouchStart = (event: TouchEvent) => {
        sLog(`touchstart count=${event.touches.length} target=${(event.target as Element | null)?.tagName}`);
        if (event.touches.length !== 1) return;
        lastTouchX = event.touches[0].clientX;
        lastTouchY = event.touches[0].clientY;
      };

      const handleTouchMove = (event: TouchEvent) => {
        if (event.touches.length !== 1 || lastTouchY === null || lastTouchX === null) {
          return;
        }
        const t = event.touches[0];
        const dx = lastTouchX - t.clientX;
        const dy = lastTouchY - t.clientY;
        lastTouchX = t.clientX;
        lastTouchY = t.clientY;
        if (Math.abs(dy) > 0 || Math.abs(dx) > 0) {
          // 페이지/viewport 가 같이 스크롤되는 것을 차단.
          event.preventDefault();
          dispatchWheel(dx, dy);
        }
      };

      const handleTouchEnd = () => {
        lastTouchX = null;
        lastTouchY = null;
        // swipe 끝나면 누적 잔여값 초기화 (다음 제스처가 이전 잔여를 이어받
        // 는 것 방지).
        wheelAccumX = 0;
        wheelAccumY = 0;
      };

      const previousTouchAction = container.style.touchAction;
      container.style.touchAction = 'none';

      container.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true });
      container.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false });
      container.addEventListener('touchend', handleTouchEnd, { capture: true, passive: true });
      container.addEventListener('touchcancel', handleTouchEnd, { capture: true, passive: true });

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

      const debugBS = debug;
      let bsOverlay: HTMLDivElement | null = null;
      const bsLines: string[] = [];
      if (debugBS) {
        bsOverlay = document.createElement('div');
        bsOverlay.style.cssText = [
          'position:fixed',
          'top:8px',
          'left:8px',
          'right:8px',
          'max-height:40vh',
          'overflow:hidden',
          'pointer-events:none',
          'z-index:99999',
          'background:rgba(0,0,0,0.7)',
          'color:#ffd27f',
          'font:11px/1.3 ui-monospace,monospace',
          'padding:6px 8px',
          'border-radius:6px',
          'white-space:pre-wrap',
          'word-break:break-all',
        ].join(';');
        document.body.appendChild(bsOverlay);
      }
      const bsLog = (msg: string) => {
        if (!debugBS) return;
        const line = `[${new Date().toISOString().slice(14, 23)}] ${msg}`;
        console.log('[bs]', line);
        bsLines.push(line);
        if (bsLines.length > 30) bsLines.shift();
        if (bsOverlay) bsOverlay.textContent = bsLines.join('\n');
      };

      // iOS soft keyboard 는 Backspace 롱프레스 시 keydown 을 한 번만 발생
      // 시키고 이후 repeat 정보를 웹으로 전달하지 않는다. W3C UI Events 스펙
      // 위반이며, PWA / WKWebView / Capacitor / Tauri 등으로도 우회 불가능.
      // 자세한 조사 결과는 `.omc/research/ios-soft-keyboard-repeat/report.md`
      // 에 있다.
      //
      // 따라서 "한 번 눌러 한 글자 삭제" 로만 동작한다. textarea 에 문자가
      // 있을 때는 OS 가 input 이벤트를 반복 fire 하므로 handleIOSInput 이
      // 처리한다. 빈 textarea 에서는 keydown 한 번에 \x7f 한 번.
      //
      // 향후 CodeMirror 6 의 sentinel textarea + pendingIOSKey 패턴을 이식하면
      // 진짜 repeat 도 얻을 수 있지만, 현재는 보류 상태.
      const handleIOSKeyEvent = (event: Event) => {
        if (event.type === 'keydown') {
          const ke = event as KeyboardEvent;
          if (ke.key === 'Backspace' && (helperTextarea?.value ?? '') === '') {
            bsLog(`keydown backspace (single emit)`);
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
          if (bsOverlay) bsOverlay.remove();
        }
        container.removeEventListener('touchstart', handleTouchStart, true);
        container.removeEventListener('touchmove', handleTouchMove, true);
        container.removeEventListener('touchend', handleTouchEnd, true);
        container.removeEventListener('touchcancel', handleTouchEnd, true);
        container.style.touchAction = previousTouchAction;
        if (debugOverlay) {
          debugOverlay.remove();
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
