import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ChevronsRight,
  Command,
  X,
  FolderOpen,
  LoaderCircle,
  LogIn,
  LogOut,
  MoreHorizontal,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Sun,
  SquareTerminal,
  Trash2,
  UserRound,
} from 'lucide-react';

import { TerminalSurface, type TerminalSurfaceHandle } from '@/components/terminal-surface';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
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

      await toast.promise(retryPromise, {
        loading: `${label} 재시도 중... (${attempt}/${retries})`,
        success: `${label} 다시 시도합니다.`,
        error: `${label} 재시도 준비에 실패했습니다.`,
      });
    }
  }

  throw lastError;
}

function App() {
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => getInitialThemePreference());
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionNode[]>([]);
  const [status, setStatus] = useState<StatusState>({ tone: 'secondary', message: '서버 연결 상태를 확인하는 중입니다.' });
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState('');
  const [windowSessionName, setWindowSessionName] = useState('');
  const [windowName, setWindowName] = useState('');
  const [activeDialog, setActiveDialog] = useState<'none' | 'session' | 'window'>('none');
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [commandInput, setCommandInput] = useState('');
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(null);
  const [ptyState, setPtyState] = useState<LiveConnectionState>('idle');
  const [searchQuery, setSearchQuery] = useState('');
  const [treeQuery, setTreeQuery] = useState('');
  const [openPaneIds, setOpenPaneIds] = useState<string[]>([]);

  const pendingResizeTimerRef = useRef<number | null>(null);
  const lastResizeRef = useRef('');
  const terminalRef = useRef<TerminalSurfaceHandle | null>(null);
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
      ? 'border-b border-white/15 bg-[#050816] shadow-[inset_0_-1px_0_rgba(255,255,255,0.06)]'
      : 'border-b border-slate-300 bg-slate-50 shadow-[inset_0_-1px_0_rgba(15,23,42,0.06)]';
  const selectedTabClassName =
    resolvedThemeMode === 'dark'
      ? 'border-white/20 bg-[#050816] text-slate-100'
      : 'border-slate-300 bg-slate-50 text-slate-900';
  const unselectedTabClassName =
    resolvedThemeMode === 'dark'
      ? 'border-white/8 bg-white/[0.04] text-slate-400 hover:bg-white/[0.07] hover:text-slate-200'
      : 'border-slate-200 bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700';
  const tabCloseClassName =
    resolvedThemeMode === 'dark'
      ? 'text-slate-400 hover:bg-white/10 hover:text-slate-100'
      : 'text-slate-500 hover:bg-slate-200 hover:text-slate-800';

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
    const root = document.documentElement;
    root.classList.toggle('dark', isDark);
    window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);
  }, [isDark, themePreference]);

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
        setOpenPaneIds([]);
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
    if (!currentUser && route.kind !== 'login') {
      navigate('/login', true);
      return;
    }

    if (currentUser && route.kind === 'login') {
      navigate('/', true);
    }
  }, [currentUser, navigate, route.kind]);

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

    const firstPaneId = sessions[0]?.windows[0]?.panes[0]?.id ?? null;

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

    if (!selectedPaneId && firstPaneId) {
      setSelectedPaneId(firstPaneId);
    }
  }, [currentUser, route, selectedPaneId, sessions]);

  useEffect(() => {
    if (!currentUser || !selectedPaneMeta || route.kind !== 'home') {
      return;
    }

    navigate(buildPanePath(selectedPaneMeta.sessionName, selectedPaneMeta.pane.id), true);
  }, [currentUser, navigate, route.kind, selectedPaneMeta]);

  useEffect(() => {
    if (!selectedPaneId) {
      return;
    }

    setOpenPaneIds((current) => {
      if (current.includes(selectedPaneId)) {
        return current;
      }

      return [...current, selectedPaneId].slice(-8);
    });
  }, [selectedPaneId]);

  useEffect(() => {
    if (!selectedPaneId) {
      return;
    }

    if (selectedPaneMeta) {
      return;
    }

    setSelectedPaneId(null);
    setOpenPaneIds((current) => current.filter((paneId) => paneId !== selectedPaneId));
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
      setSelectedPaneId(paneId);
      navigate(buildPanePath(sessionName, paneId));
    },
    [navigate],
  );

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
            resolve(socket);
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
              reject(createAppError(payload.error));
              return;
            }

            setPtyState('error');
            setStatus({ tone: 'destructive', message: payload.error });
          }
        };

        socket.onerror = () => {
          if (!ready) {
            reject(createAppError('PTY WebSocket 연결 중 오류가 발생했습니다.'));
            return;
          }

          setPtyState('error');
          setStatus({ tone: 'destructive', message: 'PTY WebSocket 연결 중 오류가 발생했습니다.' });
        };

        socket.onclose = () => {
          if (ptySocketRef.current === socket) {
            ptySocketRef.current = null;
          }

          if (!ready) {
            reject(createAppError('PTY WebSocket 연결이 닫혔습니다.'));
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
      setStatus({ tone: 'destructive', message: summarizeError(error) });
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

  const openPanes = useMemo(() => {
    return openPaneIds
      .map((paneId) => {
        for (const session of sessions) {
          for (const windowNode of session.windows) {
            for (const pane of windowNode.panes) {
              if (pane.id === paneId) {
                return {
                  paneId,
                  sessionName: session.name,
                  windowLabel: `${windowNode.index}. ${windowNode.name}`,
                  paneLabel: `패널 ${pane.index}`,
                };
              }
            }
          }
        }

        return null;
      })
      .filter((entry): entry is { paneId: string; sessionName: string; windowLabel: string; paneLabel: string } => entry !== null);
  }, [openPaneIds, sessions]);

  const { visibleOpenPanes, overflowOpenPanes } = useMemo(() => {
    const maxVisibleTabs = 3;

    if (openPanes.length <= maxVisibleTabs) {
      return {
        visibleOpenPanes: openPanes,
        overflowOpenPanes: [] as typeof openPanes,
      };
    }

    const initialVisible = openPanes.slice(0, maxVisibleTabs);
    const selectedIndex = openPanes.findIndex((pane) => pane.paneId === selectedPaneId);

    if (selectedIndex === -1 || selectedIndex < maxVisibleTabs) {
      return {
        visibleOpenPanes: initialVisible,
        overflowOpenPanes: openPanes.slice(maxVisibleTabs),
      };
    }

    const selectedPane = openPanes[selectedIndex];
    const nextVisible = [...openPanes.slice(0, maxVisibleTabs - 1), selectedPane];
    const visibleIds = new Set(nextVisible.map((pane) => pane.paneId));

    return {
      visibleOpenPanes: nextVisible,
      overflowOpenPanes: openPanes.filter((pane) => !visibleIds.has(pane.paneId)),
    };
  }, [openPanes, selectedPaneId]);

  const closePaneTab = useCallback((paneId: string) => {
    setOpenPaneIds((current) => {
      const closingIndex = current.indexOf(paneId);
      const next = current.filter((id) => id !== paneId);

      if (selectedPaneId === paneId) {
        const fallbackPaneId =
          next[Math.min(closingIndex, next.length - 1)] ??
          next[next.length - 1] ??
          null;
        setSelectedPaneId(fallbackPaneId);

        if (fallbackPaneId) {
          for (const session of sessions) {
            for (const windowNode of session.windows) {
              const pane = windowNode.panes.find((candidate) => candidate.id === fallbackPaneId);
              if (pane) {
                navigate(buildPanePath(session.name, pane.id));
                return next;
              }
            }
          }
        } else {
          navigate('/');
        }
      }

      return next;
    });
  }, [navigate, selectedPaneId, sessions]);

  const filteredSessions = useMemo(() => {
    const query = treeQuery.trim().toLowerCase();
    if (!query) {
      return sessions;
    }

    return sessions
      .map((session) => {
        const sessionMatch = session.name.toLowerCase().includes(query);
        const windows = session.windows
          .map((windowNode) => {
            const windowMatch = `${windowNode.index}. ${windowNode.name}`.toLowerCase().includes(query);
            const panes = windowNode.panes.filter((pane) => {
              const paneHaystack = [pane.id, `패널 ${pane.index}`, pane.currentCommand, pane.currentPath, pane.title]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();

              return paneHaystack.includes(query);
            });

            if (sessionMatch || windowMatch) {
              return windowNode;
            }

            if (panes.length === 0) {
              return null;
            }

            return { ...windowNode, panes };
          })
          .filter((windowNode): windowNode is WindowNode => windowNode !== null);

        if (sessionMatch) {
          return session;
        }

        if (windows.length === 0) {
          return null;
        }

        return { ...session, windows };
      })
      .filter((session): session is SessionNode => session !== null);
  }, [sessions, treeQuery]);

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
      setStatus({ tone: 'destructive', message: summarizeError(error) });
    } finally {
      setBusyKey(null);
    }
  };

  const openSessionDialog = () => {
    setActiveDialog('session');
  };

  const openWindowDialog = (presetSessionName?: string) => {
    if (presetSessionName) {
      setWindowSessionName(presetSessionName);
    } else if (selectedPaneMeta?.sessionName) {
      setWindowSessionName(selectedPaneMeta.sessionName);
    }
    setActiveDialog('window');
  };

  const closeDialog = () => {
    setActiveDialog('none');
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
      setOpenPaneIds([]);
      setSearchQuery('');
      navigate('/login', true);
      setStatus({ tone: 'secondary', message: '로그아웃했습니다.' });
    } catch (error) {
      setStatus({ tone: 'destructive', message: summarizeError(error) });
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
      setStatus({ tone: 'destructive', message: summarizeError(error) });
    } finally {
      setBusyKey(null);
    }
  };

  const createWindow = async () => {
    const normalizedSession = windowSessionName.trim();
    const normalizedWindow = windowName.trim();

    if (!normalizedSession || !normalizedWindow) {
      setStatus({ tone: 'destructive', message: '세션 이름과 창 이름을 모두 입력해주세요.' });
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
      setStatus({ tone: 'default', message: `${normalizedSession} 세션에 ${normalizedWindow} 창을 만들었습니다.` });
      await refreshData();
    } catch (error) {
      setStatus({ tone: 'destructive', message: summarizeError(error) });
    } finally {
      setBusyKey(null);
    }
  };

  const killSession = async (name: string) => {
    if (!window.confirm(`${name} 세션을 종료할까요?`)) {
      return;
    }

    setBusyKey(`kill:${name}`);
    try {
      await apiRequest(`/api/sessions/${encodeURIComponent(name)}`, { method: 'DELETE' });
      setStatus({ tone: 'default', message: `${name} 세션을 종료했습니다.` });
      await refreshData();
    } catch (error) {
      setStatus({ tone: 'destructive', message: summarizeError(error) });
    } finally {
      setBusyKey(null);
    }
  };

  const sendCommand = async () => {
    if (!selectedPaneId) {
      setStatus({ tone: 'destructive', message: '왼쪽 목록에서 패널을 먼저 선택해주세요.' });
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
      setStatus({ tone: 'default', message: `${selectedPaneId} 패널에 명령어를 전송했습니다.` });
    } catch (error) {
      setStatus({ tone: 'destructive', message: summarizeError(error) });
    } finally {
      setBusyKey(null);
    }
  };

  const runSearch = (direction: 'next' | 'previous') => {
    if (!searchQuery.trim()) {
      setStatus({ tone: 'destructive', message: '검색어를 입력해주세요.' });
      return;
    }

    const found = direction === 'next'
      ? terminalRef.current?.findNext(searchQuery.trim())
      : terminalRef.current?.findPrevious(searchQuery.trim());

    if (!found) {
      setStatus({ tone: 'secondary', message: `터미널에서 "${searchQuery.trim()}" 검색 결과를 찾지 못했습니다.` });
      return;
    }

    setStatus({ tone: 'default', message: `터미널에서 "${searchQuery.trim()}" 검색 결과로 이동했습니다.` });
  };

  const liveVariant = ptyState === 'error' ? 'destructive' : ptyState === 'live' ? 'default' : 'secondary';

  if (!currentUser) {
    return (
      <div className={isDark ? 'dark h-svh bg-background text-foreground' : 'h-svh bg-background text-foreground'}>
        <div className="flex h-full items-center justify-center px-4 py-8 sm:px-8">
          <div className="w-full max-w-md">
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
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={isDark ? 'dark h-svh bg-background text-foreground' : 'h-svh bg-background text-foreground'}>
      <div className="flex h-full min-h-0 flex-col">
        <header className="border-b border-border/70 bg-card/70 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold">tmux 웹 콘솔</h1>
                <Badge variant="outline">{pathname}</Badge>
                <Badge variant={liveVariant}>{ptyState === 'live' ? 'PTY 연결 중' : ptyState === 'connecting' ? '연결 중' : ptyState === 'error' ? '연결 오류' : '대기 중'}</Badge>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
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
              <Button variant="outline" onClick={() => void refreshData()} disabled={loading}>
                {loading ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              </Button>
              <Button variant="outline" onClick={() => void logout()} disabled={busyKey === 'logout'}>
                {busyKey === 'logout' ? <LoaderCircle className="size-4 animate-spin" /> : <LogOut className="size-4" />}
              </Button>
            </div>
          </div>
        </header>

        <main className="grid min-h-0 flex-1 gap-4 px-4 py-4 sm:px-6 lg:px-8 xl:grid-cols-[340px_minmax(0,1fr)_360px]">
          <Card>
            <CardHeader>
              <CardTitle>세션 트리</CardTitle>
              <CardAction className="flex gap-2">
                <Button variant="outline" onClick={openSessionDialog}>
                  <Plus className="size-4" />
                </Button>
                <Button variant="outline" onClick={() => openWindowDialog()}>
                  <Plus className="size-4" />
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
              <div className="flex items-center gap-2">
                <Search className="size-4 shrink-0 text-muted-foreground" />
                <Input value={treeQuery} onChange={(event) => setTreeQuery(event.target.value)} placeholder="세션 / 창 / 패널 검색" />
              </div>
              <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border/70 bg-background/40">
                <ScrollArea className="h-full">
                <div className="divide-y divide-border/60">
                  {filteredSessions.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground">
                      {treeQuery.trim() ? '검색 결과가 없습니다.' : '세션이 없습니다.'}
                    </div>
                  ) : (
                    filteredSessions.map((session) => (
                      <div key={session.id} className="min-w-0 bg-background/60">
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 bg-muted/30 px-3 py-2">
                          <div className="min-w-0 overflow-hidden">
                            <div className="block w-full overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold">{session.name}</div>
                            <div className="text-[11px] text-muted-foreground">창 {session.windows.length} · 붙음 {session.attached}</div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" onClick={() => openWindowDialog(session.name)}>
                              <Plus className="size-4" />
                            </Button>
                            <Button variant="ghost" onClick={() => void killSession(session.name)} disabled={busyKey === `kill:${session.name}`}>
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </div>

                        <div className="border-t border-border/50">
                          {session.windows.map((windowNode) => (
                            <div key={windowNode.id} className="min-w-0 border-b border-border/40 bg-card/20 last:border-b-0">
                              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 bg-background/40 px-3 py-1.5">
                                <div className="min-w-0 overflow-hidden">
                                  <div className="flex items-center gap-1.5">
                                    <span className="shrink-0 bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground">창</span>
                                    <div className="block w-full overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium text-foreground/90">
                                      {windowNode.index}. {windowNode.name}
                                    </div>
                                  </div>
                                </div>
                                <span className="shrink-0 text-[11px] text-muted-foreground">패널 {windowNode.panes.length}</span>
                              </div>

                              <div className="border-t border-border/30">
                                {windowNode.panes.map((pane) => {
                                  const selected = pane.id === selectedPaneId;
                                  return (
                                    <button
                                      key={pane.id}
                                      type="button"
                                      onClick={() => selectPane(session.name, pane.id)}
                                      className={[
                                        'block w-full min-w-0 overflow-hidden border-b border-border/20 px-3 py-1.5 text-left transition last:border-b-0',
                                        selected
                                          ? 'bg-primary/10 text-foreground'
                                          : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
                                      ].join(' ')}
                                    >
                                      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2">
                                        <ChevronsRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                                        <div className="min-w-0 overflow-hidden">
                                          <div className="flex items-center gap-1.5">
                                            <span className="shrink-0 bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground">패널</span>
                                            <div className="block w-full overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium">{pane.id}</div>
                                          </div>
                                          <div className="block w-full overflow-hidden text-ellipsis whitespace-nowrap text-[11px]">{pane.currentCommand || '셸'} · {pane.currentPath || '-'}</div>
                                        </div>
                                        {pane.active ? (
                                          <span className="ml-auto shrink-0 bg-primary/12 px-1.5 py-0.5 text-[10px] font-medium text-primary whitespace-nowrap">
                                            활성
                                          </span>
                                        ) : null}
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                </ScrollArea>
              </div>
            </CardContent>
          </Card>

          <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-4">
            <Card>
              <CardHeader>
                <CardTitle>터미널</CardTitle>
                <CardAction>
                  <Badge variant="outline">{selectedPaneMeta ? `${selectedPaneMeta.sessionName} / ${selectedPaneMeta.windowIndex}. ${selectedPaneMeta.windowName}` : '패널 미선택'}</Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
                <div className="grid gap-3 rounded-xl border border-border/70 bg-background/50 p-3 lg:grid-cols-[1fr_auto]">
                  <div className="flex items-center gap-2">
                    <Search className="size-4 text-muted-foreground" />
                    <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="터미널 검색" />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" onClick={() => runSearch('previous')}>
                      <ArrowUp className="size-4" /> 이전
                    </Button>
                    <Button variant="outline" onClick={() => runSearch('next')}>
                      <ArrowDown className="size-4" /> 다음
                    </Button>
                    <Button variant="outline" onClick={() => terminalRef.current?.focus()}>
                      <SquareTerminal className="size-4" /> 포커스
                    </Button>
                  </div>
                </div>

                <div className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/70 ${terminalShellClassName}`}>
                  {openPanes.length > 0 ? (
                    <div className={`px-2 pt-2 ${terminalStripClassName}`}>
                      <div className="flex min-w-0 items-end gap-1 pr-2">
                          {visibleOpenPanes.map((paneEntry) => {
                            const selected = paneEntry.paneId === selectedPaneId;
                            return (
                              <div
                                key={paneEntry.paneId}
                                className={[
                                  'flex items-center gap-1 rounded-t-lg border border-b-0 px-2.5 py-1.5 text-xs shadow-[0_-1px_0_rgba(255,255,255,0.03)]',
                                  selected ? selectedTabClassName : unselectedTabClassName,
                                ].join(' ')}
                              >
                                <button
                                  type="button"
                                  onClick={() => selectPane(paneEntry.sessionName, paneEntry.paneId)}
                                  className="max-w-[16rem] truncate text-left"
                                >
                                  {paneEntry.sessionName} · {paneEntry.windowLabel} · {paneEntry.paneLabel}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => closePaneTab(paneEntry.paneId)}
                                  className={`rounded-sm p-0.5 transition ${tabCloseClassName}`}
                                  aria-label={`${paneEntry.paneLabel} 닫기`}
                                >
                                  <X className="size-3.5" />
                                </button>
                              </div>
                            );
                          })}
                          {overflowOpenPanes.length > 0 ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost">
                                  <MoreHorizontal className="size-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-72">
                                {overflowOpenPanes.map((paneEntry) => (
                                  <DropdownMenuItem
                                    key={paneEntry.paneId}
                                    onClick={() => selectPane(paneEntry.sessionName, paneEntry.paneId)}
                                  >
                                    <span className="truncate">
                                      {paneEntry.sessionName} · {paneEntry.windowLabel} · {paneEntry.paneLabel}
                                    </span>
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                        </div>
                    </div>
                  ) : null}

                  <div className="min-h-0 flex-1 p-2">
                    <TerminalSurface
                      ref={terminalRef}
                      className="min-h-0 rounded-none bg-transparent p-0"
                      mountClassName="h-full w-full"
                      mode="stream"
                      themeMode={resolvedThemeMode}
                      selectedPaneId={selectedPaneId}
                      statusMessage={selectedPaneId ? '패널 PTY 연결 중...' : '왼쪽 목록에서 패널을 선택해주세요.'}
                      onInput={queueTerminalInput}
                      onResize={queueTerminalResize}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>명령 전송</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea placeholder="예: npm run dev" value={commandInput} onChange={(event) => setCommandInput(event.target.value)} />
                <Button onClick={() => void sendCommand()} disabled={busyKey === `command:${selectedPaneId ?? 'none'}`}>
                  {busyKey === `command:${selectedPaneId ?? 'none'}` ? <LoaderCircle className="size-4 animate-spin" /> : <Command className="size-4" />}
                  명령 전송
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="min-h-0">
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>현재 상태</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm leading-6 text-muted-foreground">{status.message}</p>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <InfoRow icon={UserRound} label="계정" value={currentUser ?? '-'} />
                  <InfoRow icon={SquareTerminal} label="패널" value={selectedPaneMeta?.pane.id ?? '-'} />
                  <InfoRow icon={Command} label="프로세스" value={selectedPaneMeta?.pane.currentCommand || '셸'} />
                  <InfoRow icon={FolderOpen} label="경로" value={selectedPaneMeta?.pane.currentPath || '-'} />
                </div>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
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

        <Dialog open={activeDialog === 'window'} onOpenChange={(open) => setActiveDialog(open ? 'window' : 'none')}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>창 만들기</DialogTitle>
              <DialogDescription>선택한 세션 또는 지정한 세션에 새 창을 만듭니다.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Input placeholder="세션 이름" value={windowSessionName} onChange={(event) => setWindowSessionName(event.target.value)} />
              <Input placeholder="창 이름" value={windowName} onChange={(event) => setWindowName(event.target.value)} />
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

        <Toaster theme={resolvedThemeMode} richColors closeButton />

    </div>
  );
}

type InfoRowProps = {
  icon: typeof Activity;
  label: string;
  value: string;
};

function InfoRow({ icon: Icon, label, value }: InfoRowProps) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/60 p-3">
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-4" /> {label}
      </div>
      <div className="break-all text-sm font-medium">{value}</div>
    </div>
  );
}

export default App;
