import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Command,
  FolderOpen,
  LoaderCircle,
  LogIn,
  LogOut,
  MonitorSmartphone,
  Plus,
  RefreshCw,
  Shield,
  SquareTerminal,
  Trash2,
  UserRound,
} from 'lucide-react';

import { TerminalSurface } from '@/components/terminal-surface';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';

type StatusTone = 'default' | 'secondary' | 'destructive';

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

type PaneSnapshot = {
  targetPane: string;
  content: string;
  lineCount: number;
  historyLines: number;
  capturedAt: string;
  includesAnsi?: boolean;
};

type StatusState = {
  tone: StatusTone;
  message: string;
};

type LiveConnectionState = 'idle' | 'connecting' | 'live' | 'error';

type SelectedPaneMeta = {
  sessionId: string;
  sessionName: string;
  windowId: string;
  windowIndex: number;
  windowName: string;
  pane: Pane;
};

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

function formatCapturedAt(value?: string) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

async function parseResponse<T>(response: Response) {
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
}

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionNode[]>([]);
  const [status, setStatus] = useState<StatusState>({
    tone: 'secondary',
    message: '서버 연결 상태를 확인하는 중입니다.',
  });
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState('');
  const [windowSessionName, setWindowSessionName] = useState('');
  const [windowName, setWindowName] = useState('');
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [commandInput, setCommandInput] = useState('');
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(null);
  const [liveSnapshot, setLiveSnapshot] = useState<PaneSnapshot | null>(null);
  const [liveState, setLiveState] = useState<LiveConnectionState>('idle');

  const pendingInputRef = useRef('');
  const pendingInputTimerRef = useRef<number | null>(null);

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
      const healthPayload = await loadHealth();
      setHealth(healthPayload);

      const authPayload = await apiRequest<AuthMeResponse>('/api/auth/me');
      setCurrentUser(authPayload.user.username);

      const treePayload = await apiRequest<TreeResponse>('/api/tree');
      setSessions(treePayload.sessions);
      setStatus({
        tone: 'secondary',
        message: `${treePayload.sessions.length}개의 세션을 불러왔습니다.`,
      });
    } catch (error) {
      const message = summarizeError(error);
      const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : undefined;

      if (statusCode === 401) {
        setCurrentUser(null);
        setSessions([]);
        setSelectedPaneId(null);
        setLiveSnapshot(null);
        setLiveState('idle');
        setStatus({
          tone: 'secondary',
          message: '로그인이 필요합니다. 아이디와 비밀번호를 입력해주세요.',
        });
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
      setLiveSnapshot(null);
      setLiveState('idle');
      return;
    }

    const firstPaneId = sessions[0]?.windows[0]?.panes[0]?.id ?? null;
    if (!selectedPaneId && firstPaneId) {
      setSelectedPaneId(firstPaneId);
      return;
    }

    if (selectedPaneId && !selectedPaneMeta && firstPaneId) {
      setSelectedPaneId(firstPaneId);
    }
  }, [currentUser, selectedPaneId, selectedPaneMeta, sessions]);

  useEffect(() => {
    if (pendingInputTimerRef.current !== null) {
      window.clearTimeout(pendingInputTimerRef.current);
      pendingInputTimerRef.current = null;
    }
    pendingInputRef.current = '';
  }, [selectedPaneId]);

  useEffect(() => {
    return () => {
      if (pendingInputTimerRef.current !== null) {
        window.clearTimeout(pendingInputTimerRef.current);
      }
    };
  }, []);

  const flushPendingInput = useCallback(async () => {
    if (!selectedPaneId) {
      pendingInputRef.current = '';
      return;
    }

    const inputChunk = pendingInputRef.current;
    pendingInputRef.current = '';
    pendingInputTimerRef.current = null;

    if (!inputChunk) {
      return;
    }

    try {
      await apiRequest(`/api/panes/${encodeURIComponent(selectedPaneId)}/input`, {
        method: 'POST',
        body: JSON.stringify({ input: inputChunk }),
      });
    } catch (error) {
      setStatus({ tone: 'destructive', message: summarizeError(error) });
    }
  }, [apiRequest, selectedPaneId]);

  const queueTerminalInput = useCallback(
    (data: string) => {
      if (!selectedPaneId) {
        return;
      }

      pendingInputRef.current += data;
      if (pendingInputTimerRef.current !== null) {
        return;
      }

      pendingInputTimerRef.current = window.setTimeout(() => {
        void flushPendingInput();
      }, 25);
    },
    [flushPendingInput, selectedPaneId],
  );

  useEffect(() => {
    if (!currentUser || !selectedPaneId) {
      return undefined;
    }

    setLiveState('connecting');
    setLiveSnapshot(null);

    const source = new EventSource(`/api/panes/${encodeURIComponent(selectedPaneId)}/stream`);

    const handleSnapshot = (event: MessageEvent) => {
      const payload = JSON.parse(event.data) as PaneSnapshot;
      setLiveSnapshot(payload);
      setLiveState('live');
    };

    const handleStreamError = (event: MessageEvent) => {
      const payload = JSON.parse(event.data) as { error?: string };
      setLiveState('error');
      if (payload.error) {
        setStatus({ tone: 'destructive', message: payload.error });
      }
    };

    source.addEventListener('snapshot', handleSnapshot as EventListener);
    source.addEventListener('stream-error', handleStreamError as EventListener);
    source.onerror = () => {
      setLiveState('error');
    };

    return () => {
      source.removeEventListener('snapshot', handleSnapshot as EventListener);
      source.removeEventListener('stream-error', handleStreamError as EventListener);
      source.close();
    };
  }, [currentUser, selectedPaneId]);

  const totals = useMemo(() => {
    const windows = sessions.reduce((sum, session) => sum + session.windows.length, 0);
    const panes = sessions.reduce(
      (sum, session) => sum + session.windows.reduce((windowSum, windowNode) => windowSum + windowNode.panes.length, 0),
      0,
    );

    return {
      windows,
      panes,
      attached: sessions.reduce((sum, session) => sum + session.attached, 0),
    };
  }, [sessions]);

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
      await refreshData();
    } catch (error) {
      setStatus({ tone: 'destructive', message: summarizeError(error) });
    } finally {
      setBusyKey(null);
    }
  };

  const logout = async () => {
    setBusyKey('logout');
    try {
      await apiRequest('/api/logout', { method: 'POST' });
      setCurrentUser(null);
      setSessions([]);
      setSelectedPaneId(null);
      setLiveSnapshot(null);
      setLiveState('idle');
      setCommandInput('');
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
      await apiRequest('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      setSessionName('');
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
      await apiRequest(`/api/sessions/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
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
        body: JSON.stringify({
          targetPane: selectedPaneId,
          command,
          enter: true,
        }),
      });
      setCommandInput('');
      setStatus({ tone: 'default', message: `${selectedPaneId} 패널에 명령어를 전송했습니다.` });
    } catch (error) {
      setStatus({ tone: 'destructive', message: summarizeError(error) });
    } finally {
      setBusyKey(null);
    }
  };

  const statusVariant =
    status.tone === 'destructive' ? 'destructive' : status.tone === 'default' ? 'default' : 'secondary';
  const liveVariant = liveState === 'error' ? 'destructive' : liveState === 'live' ? 'default' : 'secondary';

  return (
    <div className="dark min-h-svh bg-background text-foreground">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <section className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          <Card className="border border-border/70 bg-gradient-to-br from-card via-card to-primary/10">
            <CardHeader>
              <Badge variant="secondary" className="mb-2">
                tmux 원격 워크스페이스
              </Badge>
              <CardTitle className="text-3xl">왼쪽에서 선택하고 오른쪽에서 작업하는 콘솔</CardTitle>
              <CardDescription className="max-w-3xl text-sm leading-6">
                세션/창/패널 목록은 왼쪽 트리에만 모으고, 오른쪽은 실제 터미널 뷰와 작업 영역으로 유지했습니다.
                이제 긴 세션 목록 때문에 페이지 전체를 계속 스크롤할 필요가 없습니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-4">
              <OverviewCard icon={MonitorSmartphone} label="접속 대상" value={health ? `${health.host}:${health.port}` : '확인 중'} />
              <OverviewCard icon={Shield} label="인증" value="Credential + 세션 쿠키" />
              <OverviewCard icon={Activity} label="라이브 갱신" value={health ? `${health.paneStreamIntervalMs}ms` : '확인 중'} />
              <OverviewCard icon={SquareTerminal} label="패널 보관 줄 수" value={health ? `${health.paneHistoryLines}줄` : '확인 중'} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>상태</CardTitle>
              <CardDescription>현재 연결 상태와 마지막 작업 결과를 보여줍니다.</CardDescription>
              <CardAction>
                <Button variant="outline" size="sm" onClick={() => void refreshData()} disabled={loading}>
                  {loading ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  새로고침
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-3">
              <Badge variant={statusVariant}>{status.tone === 'destructive' ? '오류' : '안내'}</Badge>
              <p className="text-sm leading-6 text-muted-foreground">{status.message}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <MiniMetric label="세션" value={`${sessions.length}`} />
                <MiniMetric label="창" value={`${totals.windows}`} />
                <MiniMetric label="패널" value={`${totals.panes}`} />
              </div>
            </CardContent>
          </Card>
        </section>

        {!currentUser ? (
          <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <Card>
              <CardHeader>
                <CardTitle>로그인</CardTitle>
                <CardDescription>서버에 설정한 아이디와 비밀번호로 로그인하세요.</CardDescription>
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

            <Card>
              <CardHeader>
                <CardTitle>이번 레이아웃 변경</CardTitle>
                <CardDescription>스크롤 피로를 줄이기 위해 구조를 바꿨습니다.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
                <p>왼쪽은 세션/창/패널 탐색 전용 스크롤 영역입니다.</p>
                <p>오른쪽은 선택한 패널의 실제 터미널 뷰와 작업 카드가 고정됩니다.</p>
                <p>로그인 후에는 xterm.js 기반 입력/출력 UI를 바로 사용할 수 있습니다.</p>
              </CardContent>
            </Card>
          </section>
        ) : (
          <section className="grid min-h-0 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <Card className="min-h-[75vh] overflow-hidden lg:sticky lg:top-4 lg:h-[calc(100svh-2rem)]">
              <CardHeader>
                <CardTitle>세션 트리</CardTitle>
                <CardDescription>왼쪽에서 패널을 선택하면 오른쪽 터미널이 즉시 바뀝니다.</CardDescription>
              </CardHeader>
              <CardContent className="h-[calc(100%-5rem)] overflow-auto pr-2">
                <div className="grid gap-3">
                  {sessions.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border/80 p-4 text-sm text-muted-foreground">
                      세션이 없습니다.
                    </div>
                  ) : (
                    sessions.map((session) => (
                      <div key={session.id} className="rounded-xl border border-border/70 bg-background/40 p-3">
                        <div className="mb-3 flex items-start justify-between gap-2">
                          <div>
                            <div className="font-semibold">{session.name}</div>
                            <div className="text-xs text-muted-foreground">창 {session.windows.length}개 · 붙음 {session.attached}개</div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => void killSession(session.name)}
                            disabled={busyKey === `kill:${session.name}`}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>

                        <div className="grid gap-2">
                          {session.windows.map((windowNode) => (
                            <div key={windowNode.id} className="rounded-lg border border-border/60 bg-card/70 p-2">
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <div>
                                  <div className="text-sm font-medium">
                                    {windowNode.index}. {windowNode.name}
                                  </div>
                                  <div className="text-xs text-muted-foreground">패널 {windowNode.panes.length}개</div>
                                </div>
                                {windowNode.active ? <Badge>활성</Badge> : <Badge variant="secondary">대기</Badge>}
                              </div>

                              <div className="grid gap-2">
                                {windowNode.panes.map((pane) => {
                                  const selected = pane.id === selectedPaneId;
                                  return (
                                    <button
                                      key={pane.id}
                                      type="button"
                                      onClick={() => setSelectedPaneId(pane.id)}
                                      className={[
                                        'rounded-lg border px-3 py-2 text-left transition',
                                        selected
                                          ? 'border-primary bg-primary/10 ring-1 ring-primary/50'
                                          : 'border-border/70 bg-background/60 hover:border-primary/50 hover:bg-background',
                                      ].join(' ')}
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="text-sm font-medium">패널 {pane.index}</span>
                                        <Badge variant={pane.active ? 'default' : 'outline'}>{pane.id}</Badge>
                                      </div>
                                      <div className="mt-1 text-xs text-muted-foreground">{pane.currentCommand || '셸'} · {pane.currentPath || '-'}</div>
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
              </CardContent>
            </Card>

            <div className="grid min-h-0 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>터미널</CardTitle>
                  <CardDescription>
                    선택한 패널 출력이 xterm.js로 렌더링됩니다. 키 입력도 선택한 패널로 전달됩니다.
                  </CardDescription>
                  <CardAction>
                    <Badge variant={liveVariant}>
                      {liveState === 'live' ? '실시간 연결 중' : liveState === 'connecting' ? '연결 중' : liveState === 'error' ? '연결 오류' : '대기 중'}
                    </Badge>
                  </CardAction>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{selectedPaneMeta?.pane.id ?? '패널 미선택'}</Badge>
                    <span>{selectedPaneMeta ? `${selectedPaneMeta.sessionName} / ${selectedPaneMeta.windowIndex}. ${selectedPaneMeta.windowName}` : '왼쪽에서 패널을 선택해주세요.'}</span>
                    <span>마지막 캡처: {formatCapturedAt(liveSnapshot?.capturedAt)}</span>
                    <span>줄 수: {liveSnapshot?.lineCount ?? 0}</span>
                  </div>
                  <TerminalSurface
                    snapshot={liveSnapshot}
                    selectedPaneId={selectedPaneId}
                    statusMessage={selectedPaneId ? '패널 출력 연결 중...' : '왼쪽 목록에서 패널을 선택해주세요.'}
                    onInput={queueTerminalInput}
                  />
                </CardContent>
              </Card>

              <div className="grid gap-4 xl:grid-cols-[1fr_1fr_1.1fr]">
                <Card>
                  <CardHeader>
                    <CardTitle>현재 패널 정보</CardTitle>
                    <CardDescription>오른쪽 작업 영역은 선택한 패널 기준으로 동작합니다.</CardDescription>
                    <CardAction>
                      <Button variant="outline" size="sm" onClick={() => void logout()} disabled={busyKey === 'logout'}>
                        {busyKey === 'logout' ? <LoaderCircle className="size-4 animate-spin" /> : <LogOut className="size-4" />}
                        로그아웃
                      </Button>
                    </CardAction>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <InfoRow icon={UserRound} label="계정" value={currentUser ?? '-'} />
                    <InfoRow icon={SquareTerminal} label="패널" value={selectedPaneMeta?.pane.id ?? '-'} />
                    <InfoRow icon={Command} label="프로세스" value={selectedPaneMeta?.pane.currentCommand || '셸'} />
                    <InfoRow icon={FolderOpen} label="경로" value={selectedPaneMeta?.pane.currentPath || '-'} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>세션/창 생성</CardTitle>
                    <CardDescription>터미널 아래에서 관리 작업을 빠르게 처리합니다.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <div className="text-sm font-medium">세션 만들기</div>
                      <Input placeholder="예: dev-api" value={sessionName} onChange={(event) => setSessionName(event.target.value)} />
                      <Button onClick={() => void createSession()} disabled={busyKey === 'create-session'}>
                        <Plus className="size-4" /> 세션 생성
                      </Button>
                    </div>
                    <Separator />
                    <div className="space-y-2">
                      <div className="text-sm font-medium">창 만들기</div>
                      <Input placeholder="세션 이름" value={windowSessionName} onChange={(event) => setWindowSessionName(event.target.value)} />
                      <Input placeholder="창 이름" value={windowName} onChange={(event) => setWindowName(event.target.value)} />
                      <Button onClick={() => void createWindow()} disabled={busyKey === 'create-window'}>
                        <Plus className="size-4" /> 창 생성
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>선택 패널에 명령 보내기</CardTitle>
                    <CardDescription>
                      긴 명령이나 붙여넣기는 여기서 보내고, 짧은 입력은 위 터미널에 직접 타이핑하면 됩니다.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Textarea
                      placeholder="예: npm run dev"
                      value={commandInput}
                      onChange={(event) => setCommandInput(event.target.value)}
                    />
                    <Button onClick={() => void sendCommand()} disabled={busyKey === `command:${selectedPaneId ?? 'none'}`}>
                      {busyKey === `command:${selectedPaneId ?? 'none'}` ? <LoaderCircle className="size-4 animate-spin" /> : <Command className="size-4" />}
                      명령 전송
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

type OverviewCardProps = {
  icon: typeof Activity;
  label: string;
  value: string;
};

function OverviewCard({ icon: Icon, label, value }: OverviewCardProps) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/60 p-4">
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" /> {label}
      </div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

type MiniMetricProps = {
  label: string;
  value: string;
};

function MiniMetric({ label, value }: MiniMetricProps) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/50 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
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
