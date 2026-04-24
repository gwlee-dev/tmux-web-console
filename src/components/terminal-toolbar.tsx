import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ClipboardPaste,
  Paperclip,
} from 'lucide-react';
import { useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type TerminalToolbarProps = {
  /** 현재 선택된 pane 으로 raw bytes 를 보낸다. PTY WebSocket 이 끊겼으면 false 반환. */
  onSend: (data: string) => boolean | void;
  className?: string;
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
        // 가벼운 터미널 chrome — px-2.5 / h-8 / rounded-md / mono
        'h-8 shrink-0 rounded-md px-2.5 font-mono text-xs leading-none',
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
export function TerminalToolbar({ onSend, className }: TerminalToolbarProps) {
  const send = (data: string) => onSend(data);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pasting, setPasting] = useState(false);
  const [uploading, setUploading] = useState(false);

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

  return (
    <div
      className={cn(
        'flex w-full items-center gap-1 overflow-x-auto whitespace-nowrap border-t border-border/60 bg-background/80 px-2 py-1.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
      role="toolbar"
      aria-label="터미널 단축 키"
    >
      <ToolKey label="^B" hint="Ctrl+B (tmux 프리픽스)" onPress={() => send('\x02')} />
      <ToolKey label="^C" hint="Ctrl+C (인터럽트)" onPress={() => send('\x03')} />
      <ToolKey label="^D" hint="Ctrl+D (EOF)" onPress={() => send('\x04')} />
      <ToolKey label="Esc" hint="Escape" onPress={() => send('\x1b')} />
      <ToolKey label="Tab" hint="Tab" onPress={() => send('\t')} />
      <span className="mx-1 h-5 w-px shrink-0 bg-border/60" aria-hidden />
      <ToolKey label={<ArrowLeft className="size-3.5" />} hint="←" onPress={() => send('\x1b[D')} />
      <ToolKey label={<ArrowDown className="size-3.5" />} hint="↓" onPress={() => send('\x1b[B')} />
      <ToolKey label={<ArrowUp className="size-3.5" />} hint="↑" onPress={() => send('\x1b[A')} />
      <ToolKey label={<ArrowRight className="size-3.5" />} hint="→" onPress={() => send('\x1b[C')} />
      <span className="mx-1 h-5 w-px shrink-0 bg-border/60" aria-hidden />
      <ToolKey label="PgUp" hint="Page Up" onPress={() => send('\x1b[5~')} />
      <ToolKey label="PgDn" hint="Page Down" onPress={() => send('\x1b[6~')} />
      <span className="mx-1 h-5 w-px shrink-0 bg-border/60" aria-hidden />
      <ToolKey
        label={<ClipboardPaste className="size-3.5" />}
        hint="클립보드 붙여넣기 (텍스트/이미지 자동)"
        onPress={() => void handlePaste()}
        disabled={pasting}
      />
      <ToolKey
        label={<Paperclip className="size-3.5" />}
        hint="파일 업로드 (Claude Code 등에 경로 전달)"
        onPress={() => fileInputRef.current?.click()}
        disabled={uploading}
      />
      <input
        ref={fileInputRef}
        type="file"
        // Claude Code 등 CLI 툴이 한 줄에 들어온 여러 경로를 개별 파일로 인식
        // 하지 못하므로 한 번에 하나씩만 고르도록 제한. 클립보드로 이미지를
        // 여러 장 복사한 경우도 동일한 이유로 하나만 전송한다.
        className="hidden"
        onChange={(event) => void handleFiles(event.target.files)}
      />
    </div>
  );
}
