import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
} from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

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
  onPress: () => void;
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

/**
 * 터미널 하단 도구 툴바.
 *
 * 모바일 소프트 키보드와 데스크톱 양쪽에서 자주 쓰는 ANSI/Ctrl 키와
 * 화살표를 한 줄에 노출한다. 클릭 시 PTY 로 raw bytes 만 보낸다.
 *
 * 주의: 클립보드 / 파일 업로드 버튼은 후속 커밋에서 추가된다 (이 컴포넌트
 * 의 onSend 만 사용하므로 호출부 변경 없이 props 확장 가능).
 */
export function TerminalToolbar({ onSend, className }: TerminalToolbarProps) {
  const send = (data: string) => onSend(data);

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
    </div>
  );
}
