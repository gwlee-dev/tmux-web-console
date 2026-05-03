import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  ClipboardPaste,
  Delete,
  Paperclip,
} from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';

type TerminalToolbarProps = {
  /** 현재 선택된 pane 으로 raw bytes 를 보낸다. PTY WebSocket 이 끊겼으면 false 반환. */
  onSend: (data: string) => boolean | void;
  className?: string;
};

export type TerminalToolbarHandle = {
  /**
   * 외부 (예: terminal-surface 의 소프트 키보드 입력) 가 PTY 로 데이터를
   * 보내기 직전에 호출. 현재 armed 된 modifier 를 적용해 변환된 데이터를
   * 반환하고, 사용된 modifier 는 자동으로 disarm 된다.
   *
   * 변환 규칙:
   *   - alt: data 앞에 ESC (\x1b) prepend (xterm Alt 컨벤션)
   *   - ctrl: data 가 단일 ASCII 문자면 ASCII control byte (Ctrl+a = \x01 …)
   *   - cmd: PTY 표준 매핑 없음 — 현재는 통과
   * 모디파이어 안 켜져 있으면 data 그대로 반환.
   */
  applyAndConsume: (data: string) => string;
  /**
   * 외부 (cmd+V / iOS 네이티브 paste 등) 가 클립보드 이미지를 갖고 있을 때
   * 호출. /api/uploads 로 업로드 후 경로를 bracketed paste 로 PTY 에 전송.
   */
  pasteFiles: (files: File[]) => Promise<void>;
};

type ToolKeyProps = ComponentProps<typeof Button> & {
  label: ReactNode;
  hint?: string;
  onPress?: () => void;
};

function ToolKey({ label, hint, onPress, className, ...rest }: ToolKeyProps) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(
        // 가벼운 터미널 chrome — px-2.5 / h-8 / mono.
        // bg-transparent! 로 Button outline variant 의 bg-background /
        // dark:bg-input/30 을 무력화. button 내부 = corner triangle = 모두
        // toolbar bg 가 균일하게 비쳐 둥근 모서리가 깨끗하게 살아난다.
        'h-8 shrink-0 bg-transparent! px-2.5 font-mono text-xs leading-none dark:bg-transparent!',
        className,
      )}
      title={hint}
      aria-label={hint ?? (typeof label === 'string' ? label : undefined)}
      // 터미널 helper textarea focus 를 잃지 않도록 mousedown / touchstart 차단.
      onMouseDown={(event) => event.preventDefault()}
      onTouchStart={(event) => event.preventDefault()}
      onClick={onPress}
      {...rest}
    >
      {label}
    </Button>
  );
}

type ModifierToggleProps = {
  label: ReactNode;
  hint: string;
  pressed: boolean;
  onToggle: () => void;
};

/** Modifier 키 (Ctrl / Opt / Cmd) — shadcn Toggle 의 pressed state 그대로 사용. */
function ModifierToggle({ label, hint, pressed, onToggle }: ModifierToggleProps) {
  return (
    <Toggle
      variant="outline"
      pressed={pressed}
      onPressedChange={onToggle}
      title={hint}
      aria-label={hint}
      className="h-8 shrink-0 bg-transparent px-2.5 font-mono text-xs leading-none data-[state=on]:bg-muted"
      // 터미널 helper textarea focus 를 잃지 않도록 mousedown / touchstart 차단.
      onMouseDown={(event) => event.preventDefault()}
      onTouchStart={(event) => event.preventDefault()}
    >
      {label}
    </Toggle>
  );
}

/**
 * Pointer 기반 long-press repeat — 즉시 1회 + 400ms 지연 후 100ms 간격 자동
 * 연타. Pointer 떼는 모든 경로 (up / leave / cancel) 에서 정지.
 *
 * NewTerm / Blink Shell 의 0.4s/0.1s 패턴 그대로. Backspace / arrows / PgUp /
 * PgDn 같이 hold 가 자연스러운 키에만 사용.
 *
 * `onRelease` 는 pointer 가 떨어질 때 호출 — modifier 자동 해제 등에 사용.
 * 한 번의 hold 안에서는 modifier 가 유지되어 Ctrl+→ 연타 같은 패턴이 깨지지
 * 않는다.
 */
function useRepeatPress(action: () => void, onRelease?: () => void) {
  const actionRef = useRef(action);
  actionRef.current = action;
  const releaseRef = useRef(onRelease);
  releaseRef.current = onRelease;
  const initialRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);

  const stop = () => {
    const wasActive = initialRef.current !== null || intervalRef.current !== null;
    if (initialRef.current !== null) {
      window.clearTimeout(initialRef.current);
      initialRef.current = null;
    }
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (wasActive) releaseRef.current?.();
  };

  useEffect(() => stop, []);

  return useMemo(
    () => ({
      onPointerDown: (event: ReactPointerEvent) => {
        event.preventDefault();
        actionRef.current();
        initialRef.current = window.setTimeout(() => {
          initialRef.current = null;
          intervalRef.current = window.setInterval(() => actionRef.current(), 100);
        }, 400);
      },
      onPointerUp: stop,
      onPointerLeave: stop,
      onPointerCancel: stop,
    }),
    [],
  );
}

/**
 * 단일 데이터에 modifier 변환 적용 — terminal-surface 의 소프트 키보드 입력에서
 * 사용. Backspace / Enter / 일반 letter 모두 같은 ESC-prefix / Ctrl-byte 규칙.
 */
function applyModsTransform(
  data: string,
  mods: { ctrl: boolean; alt: boolean; cmd: boolean },
) {
  if (!data || (!mods.ctrl && !mods.alt && !mods.cmd)) return data;
  if (data.length === 1) {
    const code = data.charCodeAt(0);
    if (mods.ctrl && code >= 0x40 && code <= 0x7e) {
      // ASCII letter / symbol → Ctrl byte (a→\x01, l→\x0c …)
      return String.fromCharCode(code & 0x1f);
    }
  }
  if (mods.alt) {
    return `\x1b${data}`;
  }
  return data;
}

const BRACKETED_PASTE_START = '\x1b[200~';
const BRACKETED_PASTE_END = '\x1b[201~';

/** xterm 에 안전하게 보낼 수 있도록 \r\n / \r 을 \n 으로 정규화. */
function normalizePasteText(text: string) {
  return text.replace(/\r\n?/g, '\n');
}

function quoteShellPath(p: string) {
  // single quote 로 감싸고 내부 single quote 만 escape — 어떤 shell 에서도 안전.
  return `'${p.replace(/'/g, "'\\''")}'`;
}

async function uploadFiles(files: FileList | File[]): Promise<string[]> {
  const list = Array.from(files);
  if (list.length === 0) {
    return [];
  }
  const form = new FormData();
  for (const file of list) {
    form.append('file', file, file.name || 'upload');
  }
  const response = await fetch('/api/uploads', {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
  });
  if (!response.ok) {
    let message = `업로드 실패 (${response.status})`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const data = (await response.json()) as { paths?: string[] };
  return data.paths ?? [];
}

/**
 * 터미널 하단 도구 툴바.
 *
 * 모바일 소프트 키보드와 데스크톱 양쪽에서 자주 쓰는 ANSI/Ctrl 키, 화살표,
 * 클립보드 붙여넣기 (텍스트/이미지 자동), 일반 파일 업로드 버튼을 한 줄에
 * 노출한다. 모든 액션은 PTY 로 raw bytes 를 보낸다 (`onSend`).
 */
export const TerminalToolbar = forwardRef<TerminalToolbarHandle, TerminalToolbarProps>(function TerminalToolbar(
  { onSend, className },
  ref,
) {
  const send = (data: string) => onSend(data);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pasting, setPasting] = useState(false);
  const [uploading, setUploading] = useState(false);

  // 모디파이어 토글 — armed 상태에 따라 다음 입력에 modifier 시퀀스 적용.
  // 입력 1회 후 자동 disarm (long-press 의 경우 hold 끝나면 disarm).
  // CSI mod code 매핑: 1 + (shift=1, alt=2, ctrl=4, meta=8).
  const [mods, setMods] = useState({ ctrl: false, alt: false, cmd: false });
  const modsRef = useRef(mods);
  modsRef.current = mods;
  const toggleMod = (k: keyof typeof mods) => setMods((m) => ({ ...m, [k]: !m[k] }));
  const consumeMods = () => {
    const m = modsRef.current;
    if (m.ctrl || m.alt || m.cmd) {
      setMods({ ctrl: false, alt: false, cmd: false });
    }
  };

  const computeModCode = () => {
    const m = modsRef.current;
    let code = 1;
    if (m.alt) code += 2;
    if (m.ctrl) code += 4;
    if (m.cmd) code += 8;
    return code;
  };

  const sendArrow = (dir: 'A' | 'B' | 'C' | 'D') => {
    const code = computeModCode();
    send(code === 1 ? `\x1b[${dir}` : `\x1b[1;${code}${dir}`);
  };
  const sendPg = (n: '5' | '6') => {
    const code = computeModCode();
    send(code === 1 ? `\x1b[${n}~` : `\x1b[${n};${code}~`);
  };
  const sendBackspace = () => {
    const m = modsRef.current;
    // Alt/Ctrl + Backspace 는 readline / shells 에서 word delete (Ctrl+W = \x17).
    send(m.alt || m.ctrl ? '\x17' : '\x7f');
  };

  // hold 가 자연스러운 키 (Backspace / arrows / paging) 에 long-press repeat.
  // hold 중에는 modifier 유지 (Ctrl+→ 연타 보장), pointerup 에서 자동 해제.
  const bsHandlers = useRepeatPress(() => sendBackspace(), consumeMods);
  const arrowLeftHandlers = useRepeatPress(() => sendArrow('D'), consumeMods);
  const arrowDownHandlers = useRepeatPress(() => sendArrow('B'), consumeMods);
  const arrowUpHandlers = useRepeatPress(() => sendArrow('A'), consumeMods);
  const arrowRightHandlers = useRepeatPress(() => sendArrow('C'), consumeMods);
  const pgUpHandlers = useRepeatPress(() => sendPg('5'), consumeMods);
  const pgDnHandlers = useRepeatPress(() => sendPg('6'), consumeMods);

  // 비-repeat 키 (^B/^C/^D/Esc/Tab/paste/upload) 가 발사된 직후 modifier 자동
  // 해제. (해제 자체에는 modifier 적용 안 됨 — ctrl/alt/cmd 시퀀스를 PTY 로
  // 보내는 건 사용자 의도가 아닐 가능성이 큼.)
  const sendAndConsume = (data: string) => {
    send(data);
    consumeMods();
  };

  const sendBracketedPaste = (text: string) => {
    if (!text) return;
    send(`${BRACKETED_PASTE_START}${normalizePasteText(text)}${BRACKETED_PASTE_END}`);
  };

  const sendPathsAsPaste = (paths: string[]) => {
    if (paths.length === 0) return;
    const joined = paths.map(quoteShellPath).join(' ');
    sendBracketedPaste(joined);
  };

  const handlePaste = async () => {
    if (pasting) return;
    setPasting(true);
    try {
      // 텍스트만 필요하면 readText 가 OS 권한 프롬프트가 가벼움.
      // 이미지가 있을 가능성을 위해 read() 도 시도. 일부 브라우저는 read() 에서
      // image 미지원 또는 권한 거부 → readText 로 fallback.
      let handled = false;
      if (typeof navigator !== 'undefined' && navigator.clipboard?.read) {
        try {
          const items = await navigator.clipboard.read();
          let imageFile: File | null = null;
          let textPayload = '';
          for (const item of items) {
            const imageType = item.types.find((t) => t.startsWith('image/'));
            if (imageType && !imageFile) {
              // Claude Code 등은 한 번에 하나의 경로만 인식하므로 첫 번째
              // 이미지만 업로드한다.
              const blob = await item.getType(imageType);
              const ext = imageType.split('/')[1] || 'png';
              const stamp = Date.now();
              imageFile = new File([blob], `clipboard-${stamp}.${ext}`, {
                type: imageType,
              });
            } else if (item.types.includes('text/plain')) {
              const blob = await item.getType('text/plain');
              textPayload += await blob.text();
            }
          }
          if (imageFile) {
            const paths = await uploadFiles([imageFile]);
            sendPathsAsPaste(paths);
            handled = true;
          } else if (textPayload) {
            sendBracketedPaste(textPayload);
            handled = true;
          }
        } catch {
          /* fall through to readText */
        }
      }
      if (!handled && navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          sendBracketedPaste(text);
          handled = true;
        }
      }
      if (!handled) {
        toast.error('클립보드가 비어 있거나 접근할 수 없습니다.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '붙여넣기에 실패했습니다.');
    } finally {
      setPasting(false);
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const paths = await uploadFiles(files);
      sendPathsAsPaste(paths);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '파일 업로드에 실패했습니다.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // 외부 (cmd+V / iOS native paste) 가 paste 이벤트로 잡은 이미지를 받기
  // 위한 entry. handle 의 [] deps 안에서 stale closure 가 안 잡히도록 ref
  // indirection 사용 — 매 render 마다 최신 helpers 참조.
  const pasteFilesImplRef = useRef<(files: File[]) => Promise<void>>(async () => {});
  pasteFilesImplRef.current = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const paths = await uploadFiles(files);
      sendPathsAsPaste(paths);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '파일 업로드에 실패했습니다.');
    } finally {
      setUploading(false);
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      applyAndConsume: (data: string) => {
        const transformed = applyModsTransform(data, modsRef.current);
        consumeMods();
        return transformed;
      },
      pasteFiles: (files: File[]) => pasteFilesImplRef.current(files),
    }),
    [],
  );

  return (
    <div
      className={cn(
        // 우측 padding 0 — sticky Backspace 가 viewport 우측 끝까지 닿도록.
        // 내부 padding 은 sticky wrapper 가 자체적으로 가진다.
        // 버튼들은 bg-transparent — toolbar bg 가 button 안과 corner triangle
        // 모두에 균일하게 비쳐 둥근 모서리가 깨끗하게 보인다.
        'flex w-full items-center gap-2 overflow-x-auto whitespace-nowrap border-t border-border/60 bg-background py-1.5 pl-2 pr-0 md:pr-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
      role="toolbar"
      aria-label="터미널 단축 키"
    >
      {/*
        overflow-hidden + rounded-lg: ButtonGroup 자체에 클립 영역을 부여한다.
        ToolKey / ModifierToggle 은 bg-transparent 이므로, 버튼 border-radius
        곡률 바깥(코너 삼각형)이 투명해져 그 뒤에 있는 terminal shell 컨테이너
        (bg-[#050816]) 가 비쳐 모서리가 어둡게 잠식되는 문제가 생긴다.
        ButtonGroup 에 overflow-hidden + rounded-lg 를 주면 버튼 코너 삼각형이
        그룹 경계에서 잘려 terminal bg 가 노출되지 않는다.
        rounded-lg = var(--radius) = 0.875rem = 14px —
        버튼 끝 모서리의 rounded-r-lg! (14px) 와 곡률이 일치하므로
        clip curve 와 border-radius curve 가 정렬된다.
      */}
      <ButtonGroup className="overflow-hidden rounded-lg">
        <ToolKey label="Esc" hint="Escape" onPress={() => sendAndConsume('\x1b')} />
        <ToolKey label="Tab" hint="Tab" onPress={() => sendAndConsume('\t')} />
      </ButtonGroup>
      {/*
        Modifier 토글 — 한번 탭하면 armed (data-state=on), 다시 탭하면 disarm.
        다음에 누르는 키가 modifier 시퀀스로 전송된 직후 자동 disarm.
      */}
      <ButtonGroup className="overflow-hidden rounded-lg">
        <ModifierToggle label="⌃" hint="Ctrl modifier (다음 키에 적용)" pressed={mods.ctrl} onToggle={() => toggleMod('ctrl')} />
        <ModifierToggle label="⌥" hint="Option / Alt modifier (다음 키에 적용)" pressed={mods.alt} onToggle={() => toggleMod('alt')} />
        <ModifierToggle label="⌘" hint="Command / Meta modifier (다음 키에 적용)" pressed={mods.cmd} onToggle={() => toggleMod('cmd')} />
      </ButtonGroup>
      <ButtonGroup className="overflow-hidden rounded-lg">
        <ToolKey label={<ArrowLeft className="size-3.5" />} hint="← (홀드 = 연타)" {...arrowLeftHandlers} />
        <ToolKey label={<ArrowDown className="size-3.5" />} hint="↓ (홀드 = 연타)" {...arrowDownHandlers} />
        <ToolKey label={<ArrowUp className="size-3.5" />} hint="↑ (홀드 = 연타)" {...arrowUpHandlers} />
        <ToolKey label={<ArrowRight className="size-3.5" />} hint="→ (홀드 = 연타)" {...arrowRightHandlers} />
      </ButtonGroup>
      <ButtonGroup className="overflow-hidden rounded-lg">
        <ToolKey label="^B" hint="Ctrl+B (tmux 프리픽스)" onPress={() => sendAndConsume('\x02')} />
        <ToolKey label="^C" hint="Ctrl+C (인터럽트)" onPress={() => sendAndConsume('\x03')} />
        <ToolKey label="^D" hint="Ctrl+D (EOF)" onPress={() => sendAndConsume('\x04')} />
      </ButtonGroup>
      <ButtonGroup className="overflow-hidden rounded-lg">
        <ToolKey label={<ChevronsUp className="size-3.5" />} hint="Page Up (홀드 = 연타)" {...pgUpHandlers} />
        <ToolKey label={<ChevronsDown className="size-3.5" />} hint="Page Down (홀드 = 연타)" {...pgDnHandlers} />
      </ButtonGroup>
      <ButtonGroup className="overflow-hidden rounded-lg">
        <ToolKey
          label={<ClipboardPaste className="size-3.5" />}
          hint="클립보드 붙여넣기 (텍스트/이미지 자동)"
          onPress={() => {
            consumeMods();
            void handlePaste();
          }}
          disabled={pasting}
        />
        <ToolKey
          label={<Paperclip className="size-3.5" />}
          hint="파일 업로드 (Claude Code 등에 경로 전달)"
          onPress={() => {
            consumeMods();
            fileInputRef.current?.click();
          }}
          disabled={uploading}
        />
      </ButtonGroup>
      <input
        ref={fileInputRef}
        type="file"
        // Claude Code 등 CLI 툴이 한 줄에 들어온 여러 경로를 개별 파일로 인식
        // 하지 못하므로 한 번에 하나씩만 고르도록 제한. 클립보드로 이미지를
        // 여러 장 복사한 경우도 동일한 이유로 하나만 전송한다.
        className="hidden"
        onChange={(event) => void handleFiles(event.target.files)}
      />
      {/*
        Sticky Backspace — 모바일 전용 (데스크탑은 하드웨어 키보드 사용).
        toolbar 좌우 스크롤 시 항상 우측 끝에 노출.
        wrapper 자체는 solid `bg-background` 로 스크롤 콘텐츠를 완전히 occlude.
        wrapper 좌측 외부에 짧은 (w-4) gradient 가 absolute 로 떠 있어 soft
        edge 효과만 제공 — 다른 버튼과 겹치지 않을 정도로 짧게.
      */}
      <div className="sticky right-0 ml-auto flex shrink-0 items-stretch self-stretch bg-background pl-1 pr-2 md:hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute right-full top-0 h-full w-4 bg-gradient-to-r from-transparent to-background"
        />
        <ToolKey
          label={<Delete className="size-3.5" />}
          hint="Backspace (홀드 = 연타)"
          {...bsHandlers}
        />
      </div>
    </div>
  );
});
