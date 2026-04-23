import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  LoaderCircle,
  LogIn,
  LogOut,
  Clipboard,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  SendHorizontal,
  Sun,
  SquareTerminal,
  Trash2,
  X,
} from 'lucide-react';

import { TerminalSurface, type TerminalSurfaceHandle } from '@/components/terminal-surface';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarInput, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarSeparator, SidebarTrigger } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

type StatusTone = 'default' | 'secondary' | 'destructive';
type LiveConnectionState = 'idle' | 'connecting' | 'live' | 'error';
type AppError = Error & { statusCode?: number };

type HealthResponse = {
  ok: boolean;
  host: string;
  port: number;
  authMode: 'credentials';
  cookieSecure: boolean;
  paneHistoryLines: number;
  paneStreamIntervalMs: number;
};

type AuthMeResponse = {
  authenticated: true;
  user: {
    username: string;
  };
};

type LoginResponse = {
  ok: true;
  user: {
    username: string;
  };
};

type Pane = {
  id: string;
  index: number;
  active: boolean;
  title: string;
  currentCommand: string;
  currentPath: string;
};

type WindowNode = {
  id: string;
  index: number;
  name: string;
  active: boolean;
  panes: Pane[];
};

type SessionNode = {
  id: string;
  name: string;
  attached: number;
  windows: WindowNode[];
};

type TreeResponse = {
  sessions: SessionNode[];
};

type StatusState = {
  tone: StatusTone;
  message: string;
};

type SelectedPaneMeta = {
  sessionId: string;
  sessionName: string;
  windowId: string;
  windowIndex: number;
  windowName: string;
  pane: Pane;
};

type PtySocketMessage =
  | { type: 'ready'; paneId: string; sessionName: string; windowId: string; windowName: string }
  | { type: 'output'; data: string }
  | { type: 'exit'; exitCode?: number; signal?: number }
  | { type: 'error'; error?: string };

type AppRoute =
  | { kind: 'login' }
  | { kind: 'home' }
  | { kind: 'pane'; sessionName: string; paneId: string };

type ThemePreference = 'system' | 'light' | 'dark';
type ResolvedThemeMode = 'light' | 'dark';

const THEME_STORAGE_KEY = 'tmux-web-console-theme';
const RECENT_SESSIONS_STORAGE_KEY = 'tmux-web-console-recent-sessions';

function getInitialThemePreference(): ThemePreference {
  if (typeof window === 'undefined') {
    return 'system';
  }

  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === 'system' || saved === 'light' || saved === 'dark') {
    return saved;
  }

  return 'system';
}

function summarizeError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return '알 수 없는 오류가 발생했습니다.';
}

function reportError(error: unknown) {
  const message = summarizeError(error)
  toast.error(message)
  return message
}

function createAppError(message: string, statusCode?: number) {
  const error = new Error(message) as AppError;
  error.statusCode = statusCode;
  return error;
}

function parseResponse<T>(response: Response) {
  return (async () => {
    const contentType = response.headers.get('content-type') ?? '';
    const payload: unknown = contentType.includes('application/json') ? await response.json() : await response.text();

    if (!response.ok) {
      if (typeof payload === 'string') {
        throw createAppError(payload || `요청이 실패했습니다. (${response.status})`, response.status);
      }

      if (typeof payload === 'object' && payload !== null && 'error' in payload) {
        const message = payload.error;
        if (typeof message === 'string' && message.length > 0) {
          throw createAppError(message, response.status);
        }
      }

      throw createAppError(`요청이 실패했습니다. (${response.status})`, response.status);
    }

    return payload as T;
  })();
}

function parseRoute(pathname: string): AppRoute {
  if (pathname === '/login') {
    return { kind: 'login' };
  }

  const paneMatch = pathname.match(/^\/sessions\/([^/]+)\/panes\/([^/]+)$/);
  if (paneMatch) {
    return {
      kind: 'pane',
      sessionName: decodeURIComponent(paneMatch[1]),
      paneId: decodeURIComponent(paneMatch[2]),
    };
  }

  return { kind: 'home' };
}

function buildPanePath(sessionName: string, paneId: string) {
  return `/sessions/${encodeURIComponent(sessionName)}/panes/${encodeURIComponent(paneId)}`;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}


function getRetryToastCopy(label: string, attempt: number, retries: number) {
  if (label === '터미널 연결') {
    return {
      id: 'retry:pty-connect',
      loading: `터미널 연결을 다시 시도하는 중... (${attempt}/${retries})`,
      success: `터미널 연결을 다시 시도합니다.`,
      error: `터미널 연결 재시도 준비에 실패했습니다.`,
    };
  }


  if (label === '세션 목록') {
    return null;
  }

  return {
    id: `retry:${label}`,
    loading: `${label} 재시도 중... (${attempt}/${retries})`,
    success: `${label} 다시 시도합니다.`,
    error: `${label} 재시도 준비에 실패했습니다.`,
  };
}

async function withReadRetry<T>(
  label: string,
  run: () => Promise<T>,
  {
    retries = 2,
    onRetry,
    shouldRetry,
  }: {
    retries?: number;
    onRetry?: (attempt: number, error: unknown) => void;
    shouldRetry?: (error: unknown) => boolean;
  } = {},
) {
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= retries) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (shouldRetry && !shouldRetry(error)) {
        break;
      }
      if (attempt === retries) {
        break;
      }

      attempt += 1;
      onRetry?.(attempt, error);

      const retryPromise = (async () => {
        await delay(350 * attempt);
        return attempt;
      })();
      const retryToastCopy = getRetryToastCopy(label, attempt, retries);

      if (retryToastCopy) {
        await toast.promise(retryPromise, {
          id: retryToastCopy.id,
          loading: retryToastCopy.loading,
          success: retryToastCopy.success,
          error: retryToastCopy.error,
        });
      } else {
        await retryPromise;
      }
    }
  }

  throw lastError;
}

function App() {
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => getInitialThemePreference());
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [viewportHeight, setViewportHeight] = useState(() => window.visualViewport?.height ?? window.innerHeight);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionNode[]>([]);
  const [, setStatus] = useState<StatusState>({ tone: 'secondary', message: '서버 연결 상태를 확인하는 중입니다.' });
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState('');
  const [windowSessionName, setWindowSessionName] = useState('');
  const [windowName, setWindowName] = useState('');
  const [activeDialog, setActiveDialog] = useState<'none' | 'session' | 'window' | 'rename-session'>('none');
  const [sessionToKill, setSessionToKill] = useState<string | null>(null);
  const [sessionKillDialogOpen, setSessionKillDialogOpen] = useState(false);
  const [windowToKill, setWindowToKill] = useState<{ id: string; name: string } | null>(null);
  const [windowKillDialogOpen, setWindowKillDialogOpen] = useState(false);
  const [renameSourceName, setRenameSourceName] = useState('');
  const [renameSessionName, setRenameSessionName] = useState('');
  const [mobileCommandOpen, setMobileCommandOpen] = useState(false);
  const [mobileSearchBarOpen, setMobileSearchBarOpen] = useState(false);
  const [mobileSearchFocused, setMobileSearchFocused] = useState(false);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [commandInput, setCommandInput] = useState('');
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(null);
  const [ptyState, setPtyState] = useState<LiveConnectionState>('idle');
  const [searchQuery, setSearchQuery] = useState('');
  const [treeQuery, setTreeQuery] = useState('');
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const [recentSessionNames, setRecentSessionNames] = useState<string[]>(() => {
    if (typeof window === 'undefined') {
      return [];
    }

    try {
      const value = JSON.parse(window.localStorage.getItem(RECENT_SESSIONS_STORAGE_KEY) ?? '[]');
      return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
    } catch {
      return [];
    }
  });

  const pendingResizeTimerRef = useRef<number | null>(null);
  const lastResizeRef = useRef('');
  const terminalRef = useRef<TerminalSurfaceHandle | null>(null);
  const mobileCommandInputRef = useRef<HTMLInputElement | null>(null);
  const ptySocketRef = useRef<WebSocket | null>(null);
  const terminalSizeRef = useRef<{ cols: number; rows: number } | null>(null);

  const route = useMemo(() => parseRoute(pathname), [pathname]);
  const resolvedThemeMode: ResolvedThemeMode = themePreference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : themePreference;
  const isDark = resolvedThemeMode === 'dark';
  const themeIcon = resolvedThemeMode === 'dark' ? Moon : Sun;
  const terminalShellClassName =
    resolvedThemeMode === 'dark'
      ? 'bg-[#050816] text-slate-100'
      : 'bg-slate-50 text-slate-900';
  const terminalStripClassName =
    resolvedThemeMode === 'dark'
      ? 'border-b border-white/6 bg-white/[0.06] md:rounded-2xl md:border md:px-1 md:py-0.5 md:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
      : 'border-b border-slate-200 bg-slate-100 md:rounded-2xl md:border md:px-1 md:py-0.5 md:shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]';
  const selectedTabClassName =
    resolvedThemeMode === 'dark'
      ? 'border-transparent bg-white/[0.14] text-slate-50 shadow-sm'
      : 'border-transparent bg-background text-slate-900 shadow-sm';
  const unselectedTabClassName =
    resolvedThemeMode === 'dark'
      ? 'border-transparent bg-transparent text-slate-300 hover:bg-white/[0.06] hover:text-slate-100'
      : 'border-transparent bg-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'
;

  const navigate = useCallback((nextPath: string, replace = false) => {
    if (window.location.pathname === nextPath) {
      setPathname(nextPath);
      return;
    }

    if (replace) {
      window.history.replaceState({}, '', nextPath);
    } else {
      window.history.pushState({}, '', nextPath);
    }
    setPathname(nextPath);
  }, []);

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches);
    setSystemPrefersDark(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    const updateViewportHeight = () => {
      setViewportHeight(viewport?.height ?? window.innerHeight);
    };

    updateViewportHeight();
    viewport?.addEventListener('resize', updateViewportHeight);
    viewport?.addEventListener('scroll', updateViewportHeight);
    window.addEventListener('resize', updateViewportHeight);

    return () => {
      viewport?.removeEventListener('resize', updateViewportHeight);
      viewport?.removeEventListener('scroll', updateViewportHeight);
      window.removeEventListener('resize', updateViewportHeight);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', isDark);
    window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);
  }, [isDark, themePreference]);

  useEffect(() => {
    window.localStorage.setItem(RECENT_SESSIONS_STORAGE_KEY, JSON.stringify(recentSessionNames.slice(0, 6)));
  }, [recentSessionNames]);

  const rememberRecentSession = useCallback((name: string) => {
    setRecentSessionNames((current) => [name, ...current.filter((entry) => entry !== name)].slice(0, 6));
  }, []);

  const setTheme = useCallback((nextTheme: ThemePreference) => {
    setThemePreference(nextTheme);
  }, []);

  const apiRequest = useCallback(async <T,>(path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }

    const response = await fetch(path, {
      ...init,
      headers,
      credentials: 'same-origin',
    });

    return parseResponse<T>(response);
  }, []);

  const loadHealth = useCallback(async () => {
    const response = await fetch('/api/health', { credentials: 'same-origin' });
    return parseResponse<HealthResponse>(response);
  }, []);

  const refreshData = useCallback(async () => {
    setLoading(true);

    try {
      const { authPayload, treePayload } = await withReadRetry(
        '세션 목록',
        async () => {
          await loadHealth();
          const authPayload = await apiRequest<AuthMeResponse>('/api/auth/me');
          const treePayload = await apiRequest<TreeResponse>('/api/tree');
          return { authPayload, treePayload };
        },
        {
          shouldRetry: (error) => {
            const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : undefined;
            return statusCode !== 401;
          },
        },
      );

      setCurrentUser(authPayload.user.username);
      setSessions(treePayload.sessions);
      setStatus({ tone: 'secondary', message: `${treePayload.sessions.length}개의 세션을 불러왔습니다.` });
    } catch (error) {
      const message = summarizeError(error);
      const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : undefined;

      if (statusCode === 401) {
        setCurrentUser(null);
        setSessions([]);
        setSelectedPaneId(null);
        setPtyState('idle');
        setStatus({ tone: 'secondary', message: '로그인이 필요합니다. 아이디와 비밀번호를 입력해주세요.' });
      } else {
        setStatus({ tone: 'destructive', message });
      }
    } finally {
      setLoading(false);
    }
  }, [apiRequest, loadHealth]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!currentUser && route.kind !== 'login') {
      navigate('/login', true);
      return;
    }

    if (currentUser && route.kind === 'login') {
      navigate('/', true);
    }
  }, [currentUser, loading, navigate, route.kind]);

  const selectedPaneMeta = useMemo<SelectedPaneMeta | null>(() => {
    if (!selectedPaneId) {
      return null;
    }

    for (const session of sessions) {
      for (const windowNode of session.windows) {
        for (const pane of windowNode.panes) {
          if (pane.id === selectedPaneId) {
            return {
              sessionId: session.id,
              sessionName: session.name,
              windowId: windowNode.id,
              windowIndex: windowNode.index,
              windowName: windowNode.name,
              pane,
            };
          }
        }
      }
    }

    return null;
  }, [selectedPaneId, sessions]);

  useEffect(() => {
    if (!currentUser) {
      setSelectedPaneId(null);
      setPtyState('idle');
      return;
    }

    if (route.kind === 'pane') {
      const routePaneExists = sessions.some((session) =>
        session.name === route.sessionName && session.windows.some((windowNode) => windowNode.panes.some((pane) => pane.id === route.paneId)),
      );

      if (routePaneExists) {
        if (selectedPaneId !== route.paneId) {
          setSelectedPaneId(route.paneId);
        }
        return;
      }
    }

    if (route.kind === 'home') {
      setSelectedPaneId(null);
    }
  }, [currentUser, route, selectedPaneId, sessions]);


  useEffect(() => {
    if (!selectedPaneId || selectedPaneMeta) {
      return;
    }

    setSelectedPaneId(null);
  }, [selectedPaneId, selectedPaneMeta]);

  useEffect(() => {
    return () => {
      if (pendingResizeTimerRef.current !== null) {
        window.clearTimeout(pendingResizeTimerRef.current);
      }
      ptySocketRef.current?.close();
    };
  }, []);

  const sendPtyMessage = useCallback((payload: Record<string, unknown>) => {
    const socket = ptySocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    socket.send(JSON.stringify(payload));
    return true;
  }, []);

  const selectPane = useCallback(
    (sessionName: string, paneId: string) => {
      rememberRecentSession(sessionName);
      setSelectedPaneId(paneId);
      navigate(buildPanePath(sessionName, paneId));
    },
    [navigate, rememberRecentSession],
  );

  const selectSession = useCallback((sessionName: string) => {
    const session = sessions.find((entry) => entry.name === sessionName);
    if (!session) {
      return;
    }

    const activeWindow = session.windows.find((windowNode) => windowNode.active) ?? session.windows[0];
    const targetPane = activeWindow?.panes.find((pane) => pane.active) ?? activeWindow?.panes[0];
    if (targetPane) {
      selectPane(session.name, targetPane.id);
    }
  }, [selectPane, sessions]);

  const selectWindow = useCallback((sessionName: string, windowId: string) => {
    const session = sessions.find((entry) => entry.name === sessionName);
    const windowNode = session?.windows.find((entry) => entry.id === windowId);
    const targetPane = windowNode?.panes.find((pane) => pane.active) ?? windowNode?.panes[0];
    if (session && targetPane) {
      selectPane(session.name, targetPane.id);
    }
  }, [selectPane, sessions]);

  const queueTerminalInput = useCallback(
    (data: string) => {
      if (!selectedPaneId || !data) {
        return;
      }

      if (!sendPtyMessage({ type: 'input', data })) {
        setStatus({ tone: 'secondary', message: 'PTY 연결이 아직 준비되지 않았습니다.' });
      }
    },
    [selectedPaneId, sendPtyMessage],
  );

  const queueTerminalResize = useCallback(
    (size: { cols: number; rows: number }) => {
      terminalSizeRef.current = size;

      if (!selectedPaneId) {
        return;
      }

      const signature = `${selectedPaneId}:${size.cols}x${size.rows}`;
      if (lastResizeRef.current === signature) {
        return;
      }

      if (pendingResizeTimerRef.current !== null) {
        window.clearTimeout(pendingResizeTimerRef.current);
      }

      pendingResizeTimerRef.current = window.setTimeout(() => {
        pendingResizeTimerRef.current = null;
        lastResizeRef.current = signature;
        sendPtyMessage({ type: 'resize', cols: size.cols, rows: size.rows });
      }, 120);
    },
    [selectedPaneId, sendPtyMessage],
  );

  useEffect(() => {
    if (!currentUser || !selectedPaneId) {
      ptySocketRef.current?.close();
      ptySocketRef.current = null;
      return undefined;
    }

    setPtyState('connecting');
    terminalRef.current?.clear();
    let cancelled = false;
    let activeSocket: WebSocket | null = null;

    const connectSocket = () =>
      new Promise<WebSocket>((resolve, reject) => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const params = new URLSearchParams({
          paneId: selectedPaneId,
          cols: String(terminalSizeRef.current?.cols ?? 120),
          rows: String(terminalSizeRef.current?.rows ?? 32),
        });
        const socket = new WebSocket(`${protocol}//${window.location.host}/api/pty/socket?${params.toString()}`);

        let ready = false;
        let settled = false;
        const rejectOnce = (error: AppError) => {
          if (settled) {
            return;
          }
          settled = true;
          reject(error);
        };
        const resolveOnce = (nextSocket: WebSocket) => {
          if (settled) {
            return;
          }
          settled = true;
          resolve(nextSocket);
        };

        activeSocket = socket;
        ptySocketRef.current = socket;

        socket.onopen = () => {
          terminalRef.current?.focus();
          if (terminalSizeRef.current) {
            socket.send(JSON.stringify({ type: 'resize', cols: terminalSizeRef.current.cols, rows: terminalSizeRef.current.rows }));
          }
        };

        socket.onmessage = (event) => {
          const payload = JSON.parse(event.data) as PtySocketMessage;

          if (payload.type === 'ready') {
            ready = true;
            setPtyState('live');
            terminalRef.current?.clear();
            setStatus({ tone: 'default', message: `${payload.sessionName} 세션 PTY에 연결했습니다.` });
            resolveOnce(socket);
            return;
          }

          if (payload.type === 'output') {
            terminalRef.current?.write(payload.data);
            return;
          }

          if (payload.type === 'exit') {
            setPtyState('idle');
            setStatus({ tone: 'secondary', message: 'PTY 세션이 종료되었습니다.' });
            void refreshData();
            return;
          }

          if (payload.type === 'error' && payload.error) {
            if (!ready) {
              rejectOnce(createAppError(payload.error));
              return;
            }

            setPtyState('error');
            setStatus({ tone: 'destructive', message: payload.error });
            toast.error(payload.error);
          }
        };

        socket.onerror = () => {
          if (!ready) {
            rejectOnce(createAppError('PTY WebSocket 연결 중 오류가 발생했습니다.'));
            return;
          }

          setPtyState('error');
          setStatus({ tone: 'destructive', message: 'PTY WebSocket 연결 중 오류가 발생했습니다.' });
          toast.error('PTY WebSocket 연결 중 오류가 발생했습니다.');
        };

        socket.onclose = () => {
          if (ptySocketRef.current === socket) {
            ptySocketRef.current = null;
          }

          if (!ready) {
            rejectOnce(createAppError('PTY WebSocket 연결이 닫혔습니다.'));
            return;
          }

          if (!cancelled) {
            void refreshData();
          }

          setPtyState((current) => (current === 'error' ? 'error' : 'idle'));
        };
      });

    void withReadRetry('터미널 연결', connectSocket, {
      retries: 2,
    }).catch((error) => {
      if (cancelled) {
        return;
      }

      setPtyState('error');
      setStatus({ tone: 'destructive', message: reportError(error) });
    });

    return () => {
      cancelled = true;
      activeSocket?.close();
      if (ptySocketRef.current === activeSocket) {
        ptySocketRef.current = null;
      }
    };
  }, [currentUser, refreshData, selectedPaneId, sendPtyMessage]);

  useEffect(() => {
    if (selectedPaneId) {
      terminalRef.current?.focus();
      terminalRef.current?.fit();
    }
  }, [selectedPaneId]);

  useEffect(() => {
    terminalRef.current?.fit();
  }, [viewportHeight]);

  useEffect(() => {
    if (mobileCommandOpen) {
      window.setTimeout(() => mobileCommandInputRef.current?.focus(), 0)
    }
  }, [mobileCommandOpen]);

  const selectedSessionNode = useMemo(() => {
    const sessionName = selectedPaneMeta?.sessionName ?? (route.kind === 'pane' ? route.sessionName : null);
    if (!sessionName) {
      return null;
    }

    return sessions.find((session) => session.name === sessionName) ?? null;
  }, [route, selectedPaneMeta, sessions]);

  const sessionWindows = selectedSessionNode?.windows ?? [];

  const filteredSessions = useMemo(() => {
    const orderedSessions = [...sessions].reverse()
    const query = treeQuery.trim().toLowerCase();
    if (!query) {
      return orderedSessions;
    }

    return orderedSessions.filter((session) => session.name.toLowerCase().includes(query));
  }, [sessions, treeQuery]);

  const recentSessions = useMemo(() => {
    const ordered = recentSessionNames
      .map((name) => sessions.find((session) => session.name === name) ?? null)
      .filter((session): session is SessionNode => session !== null);

    return ordered;
  }, [recentSessionNames, sessions]);

  const login = async () => {
    const username = loginUsername.trim();
    const password = loginPassword;

    if (!username || !password) {
      setStatus({ tone: 'destructive', message: '아이디와 비밀번호를 모두 입력해주세요.' });
      return;
    }

    setBusyKey('login');
    try {
      const result = await apiRequest<LoginResponse>('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setCurrentUser(result.user.username);
      setLoginPassword('');
      setStatus({ tone: 'default', message: `${result.user.username} 계정으로 로그인했습니다.` });
      navigate('/', true);
      await refreshData();
    } catch (error) {
      setStatus({ tone: 'destructive', message: reportError(error) });
    } finally {
      setBusyKey(null);
    }
  };

  const openSessionDialog = () => {
    setActiveDialog('session');
  };

  const openWindowDialog = (presetSessionName: string) => {
    setWindowSessionName(presetSessionName);
    setActiveDialog('window');
  };

  const closeDialog = () => {
    setActiveDialog('none');
    setWindowSessionName('');
    setWindowName('');
    setRenameSourceName('');
    setRenameSessionName('');
  };

  const openRenameSessionDialog = (name: string) => {
    setRenameSourceName(name);
    setRenameSessionName(name);
    setActiveDialog('rename-session');
  };

  const logout = async () => {
    setBusyKey('logout');
    try {
      await apiRequest('/api/logout', { method: 'POST' });
      ptySocketRef.current?.close();
      ptySocketRef.current = null;
      setCurrentUser(null);
      setSessions([]);
      setSelectedPaneId(null);
      setPtyState('idle');
      setCommandInput('');
      setSearchQuery('');
      navigate('/login', true);
      setStatus({ tone: 'secondary', message: '로그아웃했습니다.' });
    } catch (error) {
      setStatus({ tone: 'destructive', message: reportError(error) });
    } finally {
      setBusyKey(null);
    }
  };

  const createSession = async () => {
    const name = sessionName.trim();
    if (!name) {
      setStatus({ tone: 'destructive', message: '세션 이름을 입력해주세요.' });
      return;
    }

    setBusyKey('create-session');
    try {
      await apiRequest('/api/sessions', { method: 'POST', body: JSON.stringify({ name }) });
      setSessionName('');
      closeDialog();
      setStatus({ tone: 'default', message: `세션 ${name} 을(를) 만들었습니다.` });
      await refreshData();
    } catch (error) {
      setStatus({ tone: 'destructive', message: reportError(error) });
    } finally {
      setBusyKey(null);
    }
  };

  const createWindow = async () => {
    const normalizedSession = windowSessionName.trim();
    const normalizedWindow = windowName.trim();

    if (!normalizedSession) {
      setStatus({ tone: 'destructive', message: '세션을 다시 선택해주세요.' });
      return;
    }

    if (!normalizedWindow) {
      setStatus({ tone: 'destructive', message: 'Window 이름을 입력해주세요.' });
      return;
    }

    setBusyKey('create-window');
    try {
      await apiRequest('/api/windows', {
        method: 'POST',
        body: JSON.stringify({ sessionName: normalizedSession, name: normalizedWindow }),
      });
      setWindowSessionName('');
      setWindowName('');
      closeDialog();
      setStatus({ tone: 'default', message: `${normalizedSession} 세션에 ${normalizedWindow} Window를 만들었습니다.` });
      await refreshData();
    } catch (error) {
      setStatus({ tone: 'destructive', message: reportError(error) });
    } finally {
      setBusyKey(null);
    }
  };

  const closeWindow = async (windowId: string) => {
    const currentSession = selectedSessionNode;
    if (!currentSession) {
      return;
    }

    const fallbackWindow = currentSession.windows.find((windowNode) => windowNode.id !== windowId);
    const fallbackPane = fallbackWindow?.panes.find((pane) => pane.active) ?? fallbackWindow?.panes[0] ?? null;
    const shouldLeaveRoute = selectedPaneMeta?.windowId === windowId;

    setBusyKey(`kill-window:${windowId}`);
    try {
      await apiRequest(`/api/windows/${encodeURIComponent(windowId)}`, { method: 'DELETE' });
      setWindowKillDialogOpen(false);
      await refreshData();

      if (shouldLeaveRoute) {
        if (fallbackPane) {
          selectPane(currentSession.name, fallbackPane.id);
        } else {
          navigate('/');
        }
      }
    } catch (error) {
      setStatus({ tone: 'destructive', message: reportError(error) });
    } finally {
      setBusyKey(null);
    }
  };

  const renameSession = async () => {
    const sourceName = renameSourceName.trim();
    const nextName = renameSessionName.trim();

    if (!sourceName || !nextName) {
      setStatus({ tone: 'destructive', message: '세션 이름을 입력해주세요.' });
      return;
    }

    setBusyKey(`rename:${sourceName}`);
    try {
      await apiRequest(`/api/sessions/${encodeURIComponent(sourceName)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: nextName }),
      });
      closeDialog();
      setStatus({ tone: 'default', message: `${sourceName} 세션 이름을 ${nextName}(으)로 변경했습니다.` });
      if (selectedSessionNode?.name === sourceName && selectedPaneId) {
        navigate(buildPanePath(nextName, selectedPaneId), true);
      }
      await refreshData();
    } catch (error) {
      setStatus({ tone: 'destructive', message: reportError(error) });
    } finally {
      setBusyKey(null);
    }
  };

  const killSession = async (name: string) => {
    setBusyKey(`kill:${name}`);
    try {
      await apiRequest(`/api/sessions/${encodeURIComponent(name)}`, { method: 'DELETE' });
      setSessionKillDialogOpen(false);
      setStatus({ tone: 'default', message: `${name} 세션을 종료했습니다.` });
      await refreshData();
    } catch (error) {
      setStatus({ tone: 'destructive', message: reportError(error) });
    } finally {
      setBusyKey(null);
    }
  };

  const sendCommand = async () => {
    if (!selectedPaneId) {
      setStatus({ tone: 'destructive', message: '왼쪽 목록에서 pane을 먼저 선택해주세요.' });
      return;
    }

    const command = commandInput.trim();
    if (!command) {
      setStatus({ tone: 'destructive', message: '보낼 명령어를 입력해주세요.' });
      return;
    }

    setBusyKey(`command:${selectedPaneId}`);
    try {
      await apiRequest('/api/commands', {
        method: 'POST',
        body: JSON.stringify({ targetPane: selectedPaneId, command, enter: true }),
      });
      setCommandInput('');
      setStatus({ tone: 'default', message: `${selectedPaneId} pane에 명령어를 전송했습니다.` });
    } catch (error) {
      setStatus({ tone: 'destructive', message: reportError(error) });
    } finally {
      setBusyKey(null);
    }
  };

  const runSearch = (direction: 'next' | 'previous') => {
    if (!searchQuery.trim()) {
      toast.error('검색어를 입력해주세요.');
      return;
    }

    const found = direction === 'next'
      ? terminalRef.current?.findNext(searchQuery.trim())
      : terminalRef.current?.findPrevious(searchQuery.trim());

    if (!found) {
      toast.message(`터미널에서 "${searchQuery.trim()}" 검색 결과를 찾지 못했습니다.`);
      return;
    }

    toast.success(`터미널에서 "${searchQuery.trim()}" 검색 결과로 이동했습니다.`);
  };

  const liveVariant = ptyState === 'error' ? 'destructive' : ptyState === 'live' ? 'default' : 'secondary';

  if (!currentUser) {
    return (
      <div className={isDark ? 'dark h-svh bg-background text-foreground' : 'h-svh bg-background text-foreground'}>
        <div className="flex h-full items-center justify-center px-4 py-8 sm:px-8">
          <div className="w-full max-w-md">
            {loading ? (
              <Card>
                <CardContent className="flex min-h-48 items-center justify-center">
                  <LoaderCircle className="size-6 animate-spin text-muted-foreground" />
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-3xl">tmux 웹 콘솔 로그인</CardTitle>
                  <CardDescription>아이디와 비밀번호로 로그인하세요.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <label className="flex flex-col gap-2 text-sm text-muted-foreground">
                    아이디
                    <Input value={loginUsername} onChange={(event) => setLoginUsername(event.target.value)} placeholder="예: admin" />
                  </label>
                  <label className="flex flex-col gap-2 text-sm text-muted-foreground">
                    비밀번호
                    <Input type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} placeholder="비밀번호 입력" />
                  </label>
                  <Button onClick={() => void login()} disabled={busyKey === 'login'}>
                    {busyKey === 'login' ? <LoaderCircle className="size-4 animate-spin" /> : <LogIn className="size-4" />}
                    로그인
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      defaultOpen
      className={isDark ? 'dark h-dvh min-h-0 overflow-hidden bg-background text-foreground' : 'h-dvh min-h-0 overflow-hidden bg-background text-foreground'}
      style={{ height: `${viewportHeight}px`, minHeight: `${viewportHeight}px` }}
    >
      <Sidebar variant="inset" collapsible="icon">
            <SidebarHeader>
              <div className="flex items-center gap-2">
                <SidebarTrigger />
                <button type="button" onClick={() => navigate('/')} className="min-w-0 flex-1 truncate text-left text-sm font-semibold hover:underline">
                  tmux 웹 콘솔
                </button>
                <Button variant="outline" size="icon" onClick={openSessionDialog}>
                  <Plus className="size-4" />
                </Button>
              </div>
              <div className="px-2 text-xs text-muted-foreground">{currentUser}</div>
              <SidebarInput value={treeQuery} onChange={(event) => setTreeQuery(event.target.value)} placeholder="세션 검색" />
            </SidebarHeader>

            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupLabel>세션 목록</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {filteredSessions.length === 0 ? (
                      <SidebarMenuItem>
                        <div className="px-2 py-3 text-sm text-muted-foreground">
                          {treeQuery.trim() ? '검색 결과가 없습니다.' : '세션이 없습니다.'}
                        </div>
                      </SidebarMenuItem>
                    ) : (
                      filteredSessions.map((session) => {
                        const selected = selectedSessionNode?.id === session.id
                        return (
                          <SidebarMenuItem key={session.id}>
                            <div
                              className="relative"
                              onMouseEnter={() => setHoveredSessionId(session.id)}
                              onMouseLeave={() => setHoveredSessionId((current) => (current === session.id ? null : current))}
                            >
                              <SidebarMenuButton
                                asChild
                                isActive={selected}
                                className={[
                                  'h-auto min-w-0 items-start py-3',
                                  hoveredSessionId === session.id ? 'pr-20' : '',
                                ].join(' ')}
                              >
                                <button type="button" onClick={() => selectSession(session.name)}>
                                  <div className="truncate text-sm font-medium">{session.name}</div>
                                </button>
                              </SidebarMenuButton>
                              {hoveredSessionId === session.id ? (
                                <div className="absolute right-2 top-1/2 z-20 flex -translate-y-1/2 items-center gap-1">
                                  <Button variant="ghost" size="icon" onClick={(event) => { event.preventDefault(); event.stopPropagation(); openRenameSessionDialog(session.name); }}>
                                    <Pencil className="size-4" />
                                  </Button>
                                  <Button variant="ghost" size="icon" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setSessionToKill(session.name); setSessionKillDialogOpen(true); }}>
                                    <Trash2 className="size-4" />
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          </SidebarMenuItem>
                        )
                      })
                    )}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>

            <SidebarSeparator />
            <SidebarFooter>
              <div className="flex items-center gap-2 px-2">
                <Badge variant={liveVariant}>{ptyState === 'live' ? 'PTY 연결 중' : ptyState === 'connecting' ? '연결 중' : ptyState === 'error' ? '연결 오류' : '대기 중'}</Badge>
              </div>
              <div className="flex items-center gap-2 px-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon">
                      {themeIcon === Moon ? <Moon className="size-4" /> : <Sun className="size-4" />}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setTheme('system')}>
                      {systemPrefersDark ? <Moon className="size-4" /> : <Sun className="size-4" />} 시스템
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setTheme('light')}>
                      <Sun className="size-4" /> 라이트
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setTheme('dark')}>
                      <Moon className="size-4" /> 다크
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="outline" size="icon" onClick={() => void refreshData()} disabled={loading}>
                  {loading ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                </Button>
                <Button variant="outline" size="icon" onClick={() => void logout()} disabled={busyKey === 'logout'}>
                  {busyKey === 'logout' ? <LoaderCircle className="size-4 animate-spin" /> : <LogOut className="size-4" />}
                </Button>
              </div>
            </SidebarFooter>
            <SidebarRail />
          </Sidebar>

          <SidebarInset>
            <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3 md:hidden">
              <SidebarTrigger />
              <button type="button" onClick={() => navigate('/')} className="min-w-0 flex-1 truncate text-left text-sm font-semibold">
                {selectedPaneMeta ? `${selectedPaneMeta.sessionName} / ${selectedPaneMeta.windowName}` : 'tmux 웹 콘솔'}
              </button>
              {route.kind === 'home' ? (
                <Button variant="outline" size="icon" onClick={openSessionDialog}>
                  <Plus className="size-4" />
                </Button>
              ) : (
                <>
                  <Button variant={mobileSearchBarOpen ? 'default' : 'outline'} size="icon" onClick={() => setMobileSearchBarOpen((open) => !open)}>
                    <Search className="size-4" />
                  </Button>
                  <Button variant={mobileCommandOpen ? 'default' : 'outline'} size="icon" onClick={() => setMobileCommandOpen(true)}>
                    <Clipboard className="size-4" />
                  </Button>
                  {selectedSessionNode ? (
                    <Button variant="outline" size="icon" onClick={() => openWindowDialog(selectedSessionNode.name)}>
                      <Plus className="size-4" />
                    </Button>
                  ) : null}
                </>
              )}
            </div>
            {route.kind === 'home' ? (
              <div className="flex h-full min-h-0 w-full flex-col px-0 py-0 md:px-6 md:py-6">
                <div className="mb-6">
                  <h1 className="text-2xl font-semibold">최근 연결한 세션</h1>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {recentSessions.map((session) => {
                    const totalPanes = session.windows.reduce((sum, windowNode) => sum + windowNode.panes.length, 0)
                    return (
                      <Card key={session.id} className="rounded-2xl">
                        <CardHeader>
                          <CardTitle className="truncate">{session.name}</CardTitle>
                          <CardDescription>
                            Window {session.windows.length} · pane {totalPanes} · 연결 {session.attached}
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <Button variant="outline" className="w-full justify-start" onClick={() => selectSession(session.name)}>
                            세션 열기
                          </Button>
                        </CardContent>
                      </Card>
                    )
                  })}
                  <Card className="rounded-2xl border-dashed bg-muted/30">
                    <CardHeader>
                      <CardTitle>새 세션</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Button className="w-full justify-start" onClick={openSessionDialog}>
                        <Plus className="size-4" />
                        새 세션 만들기
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-0 w-full flex-col px-0 py-0 md:px-6 md:py-6">
                <div className="mb-4 hidden px-4 pt-4 md:block md:px-0 md:pt-0">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-lg font-semibold">
                        {selectedPaneMeta ? `${selectedPaneMeta.sessionName} / ${selectedPaneMeta.windowName}` : 'pane 미선택'}
                      </div>
                      <div className="truncate text-sm text-muted-foreground">
                        {selectedPaneMeta?.pane.currentCommand || '왼쪽 목록에서 세션을 선택해주세요.'}
                      </div>
                    </div>

                    <div className="hidden shrink-0 items-center gap-2 md:flex">
                      <div className="flex w-[20rem] items-center gap-2 rounded-2xl border border-border/70 bg-background/80 px-3">
                        <Search className="size-4 text-muted-foreground" />
                        <Input
                          value={searchQuery}
                          onChange={(event) => setSearchQuery(event.target.value)}
                          placeholder="터미널 검색"
                          className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="none"
                          spellCheck={false}
                        />
                      </div>
                      <ButtonGroup>
                        <Button variant="outline" onClick={() => runSearch('previous')}>
                          <ArrowUp className="size-4" /> 이전
                        </Button>
                        <Button variant="outline" onClick={() => runSearch('next')}>
                          <ArrowDown className="size-4" /> 다음
                        </Button>
                        <Button variant="outline" onClick={() => terminalRef.current?.focus()}>
                          <SquareTerminal className="size-4" /> 포커스
                        </Button>
                      </ButtonGroup>
                      {selectedSessionNode ? (
                        <Button variant="outline" onClick={() => openWindowDialog(selectedSessionNode.name)}>
                          <Plus className="size-4" /> 새 Window
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>

                {mobileSearchBarOpen ? (
                  <div className="mt-3 flex w-full items-center gap-2 border-b border-border/70 px-4 pb-3 md:hidden">
                    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-border/70 bg-background/80 px-3">
                      <Search className="size-4 shrink-0 text-muted-foreground" />
                      <Input
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        onFocus={() => setMobileSearchFocused(true)}
                        onBlur={() => setMobileSearchFocused(false)}
                        placeholder="터미널 검색"
                        className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                      />
                    </div>
                    {!mobileSearchFocused ? (
                      <ButtonGroup>
                        <Button variant="outline" size="icon" onClick={() => runSearch('previous')}>
                          <ArrowUp className="size-4" />
                        </Button>
                        <Button variant="outline" size="icon" onClick={() => runSearch('next')}>
                          <ArrowDown className="size-4" />
                        </Button>
                        <Button variant="outline" size="icon" onClick={() => terminalRef.current?.focus()}>
                          <SquareTerminal className="size-4" />
                        </Button>
                      </ButtonGroup>
                    ) : null}
                  </div>
                ) : null}

                <div className={`flex min-h-0 w-full flex-1 flex-col md:rounded-[28px] md:border md:border-border/70 ${terminalShellClassName}`}>
                  {sessionWindows.length > 1 ? (
                    <div className="px-0 pt-0 md:px-1 md:pt-1">
                      <div className={terminalStripClassName}>
                      <div className="w-full overflow-x-auto overflow-y-visible whitespace-nowrap">
                        <div className="flex min-w-full items-center gap-1 px-1 py-1 md:px-0.5">
                          {sessionWindows.map((windowNode) => {
                            const selected = selectedPaneMeta?.windowId === windowNode.id
                            return (
                              <div
                                key={windowNode.id}
                                className={[
                                  'group relative min-w-[7rem] flex-1 basis-0 rounded-lg border md:min-w-[10rem] md:rounded-xl',
                                  selected ? selectedTabClassName : unselectedTabClassName,
                                ].join(' ')}
                              >
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.preventDefault()
                                    event.stopPropagation()
                                    setWindowToKill({ id: windowNode.id, name: windowNode.name }); setWindowKillDialogOpen(true)
                                  }}
                                  className={[
                                    'absolute left-1 top-1/2 z-20 -translate-y-1/2 rounded-none p-1 text-muted-foreground transition hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10 md:left-1.5 md:rounded-lg md:p-1.5 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100',
                                    selected ? 'opacity-100' : 'opacity-0',
                                  ].join(' ')}
                                  aria-label={`${windowNode.name} 닫기`}
                                >
                                  <X className="size-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => selectedSessionNode && selectWindow(selectedSessionNode.name, windowNode.id)}
                                  className={[
                                    'block min-w-0 w-full truncate py-1 text-center text-[11px] md:px-8 md:py-2 md:text-xs',
                                    selected ? 'pl-6 pr-2' : 'px-2',
                                  ].join(' ')}
                                >
                                  {windowNode.name}
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="min-h-0 flex-1 overflow-hidden px-0 pt-0 pb-0 md:px-4 md:pt-3 md:pb-3">
                    <TerminalSurface
                      ref={terminalRef}
                      className="min-h-0 rounded-none bg-transparent p-0"
                      mountClassName="h-full w-full"
                      mode="stream"
                      themeMode={resolvedThemeMode}
                      selectedPaneId={selectedPaneId}
                      statusMessage={selectedPaneId ? 'pane PTY 연결 중...' : '왼쪽 목록에서 세션을 선택해주세요.'}
                      onInput={queueTerminalInput}
                      onResize={queueTerminalResize}
                    />
                  </div>
                </div>

                <div className="mt-4 hidden w-full border-y border-border/70 bg-background/80 px-4 py-3 md:block md:rounded-[28px] md:border">
                  <div className="flex items-end gap-3">
                    <Textarea
                      className="min-h-28 flex-1 resize-none border-0 rounded-none bg-transparent px-0 py-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
                      placeholder="명령 입력"
                      value={commandInput}
                      onChange={(event) => setCommandInput(event.target.value)}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      enterKeyHint="send"
                    />
                    <Button size="icon" onClick={() => void sendCommand()} disabled={busyKey === `command:${selectedPaneId ?? 'none'}`}>
                      {busyKey === `command:${selectedPaneId ?? 'none'}` ? <LoaderCircle className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </SidebarInset>
        <Dialog open={activeDialog === 'session'} onOpenChange={(open) => setActiveDialog(open ? 'session' : 'none')}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>세션 만들기</DialogTitle>
              <DialogDescription>새 tmux 세션을 만듭니다.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Input placeholder="예: dev-api" value={sessionName} onChange={(event) => setSessionName(event.target.value)} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeDialog}>취소</Button>
              <Button onClick={() => void createSession()} disabled={busyKey === 'create-session'}>
                {busyKey === 'create-session' ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                만들기
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={activeDialog === 'window'} onOpenChange={(open) => (open ? setActiveDialog('window') : closeDialog())}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Window 만들기</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input placeholder="Window 이름" value={windowName} onChange={(event) => setWindowName(event.target.value)} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeDialog}>취소</Button>
              <Button onClick={() => void createWindow()} disabled={busyKey === 'create-window'}>
                {busyKey === 'create-window' ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                만들기
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>


        <Dialog open={mobileCommandOpen} onOpenChange={setMobileCommandOpen}>
          <DialogContent
            onPointerDownOutside={(event) => event.preventDefault()}
            onInteractOutside={(event) => event.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle>명령 입력</DialogTitle>
            </DialogHeader>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault()
                void sendCommand()
              }}
            >
              <Textarea
                ref={mobileCommandInputRef as unknown as React.RefObject<HTMLTextAreaElement>}
                value={commandInput}
                onChange={(event) => setCommandInput(event.target.value)}
                placeholder="명령 입력"
                className="min-h-28 resize-none"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="send"
              />
              <DialogFooter>
                <Button variant="outline" type="button" onClick={() => setMobileCommandOpen(false)}>취소</Button>
                <Button type="submit" disabled={busyKey === `command:${selectedPaneId ?? 'none'}`}>
                  {busyKey === `command:${selectedPaneId ?? 'none'}` ? <LoaderCircle className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
                  보내기
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>


        <Dialog open={activeDialog === 'rename-session'} onOpenChange={(open) => (open ? setActiveDialog('rename-session') : closeDialog())}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>세션 이름 변경</DialogTitle>
              <DialogDescription>{renameSourceName ? `${renameSourceName} 세션 이름을 변경합니다.` : '세션 이름을 변경합니다.'}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Input placeholder="세션 이름" value={renameSessionName} onChange={(event) => setRenameSessionName(event.target.value)} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeDialog}>취소</Button>
              <Button onClick={() => void renameSession()} disabled={busyKey === `rename:${renameSourceName}`}>
                {busyKey === `rename:${renameSourceName}` ? <LoaderCircle className="size-4 animate-spin" /> : <Pencil className="size-4" />}
                변경
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>



        <AlertDialog open={windowKillDialogOpen} onOpenChange={setWindowKillDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Window 종료</AlertDialogTitle>
              <AlertDialogDescription>
                {windowToKill ? `${windowToKill.name} Window를 종료합니다.` : 'Window를 종료합니다.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (windowToKill) {
                    void closeWindow(windowToKill.id)
                  }
                }}
              >
                종료
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={sessionKillDialogOpen} onOpenChange={setSessionKillDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>세션 종료</AlertDialogTitle>
              <AlertDialogDescription>
                {sessionToKill ? `${sessionToKill} 세션을 종료합니다. 실행 중인 Window와 pane이 함께 닫힙니다.` : '세션을 종료합니다.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (sessionToKill) {
                    void killSession(sessionToKill);
                  }
                }}
              >
                종료
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Toaster theme={resolvedThemeMode} richColors closeButton position="top-right" />
    </SidebarProvider>
  );
}

export default App;
