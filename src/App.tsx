import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Command,
  Eye,
  FolderOpen,
  LoaderCircle,
  LogIn,
  LogOut,
  MonitorSmartphone,
  PanelsTopLeft,
  Play,
  Plus,
  RefreshCw,
  Shield,
  SquareTerminal,
  Trash2,
  UserRound,
} from 'lucide-react';

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
};

type StatusState = {
  tone: StatusTone;
  message: string;
};

type LiveConnectionState = 'idle' | 'connecting' | 'live' | 'error';

type FlattenedPane = {
  pane: Pane;
  sessionName: string;
  windowName: string;
  windowIndex: number;
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
  const [commandDrafts, setCommandDrafts] = useState<Record<string, string>>({});
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(null);
  const [liveSnapshot, setLiveSnapshot] = useState<PaneSnapshot | null>(null);
  const [liveState, setLiveState] = useState<LiveConnectionState>('idle');

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

  const allPanes = useMemo<FlattenedPane[]>(() => {
    return sessions.flatMap((session) =>
      session.windows.flatMap((windowNode) =>
        windowNode.panes.map((pane) => ({
          pane,
          sessionName: session.name,
          windowName: windowNode.name,
          windowIndex: windowNode.index,
        })),
      ),
    );
  }, [sessions]);

  const selectedPaneMeta = useMemo(() => {
    if (!selectedPaneId) {
      return null;
    }

    return allPanes.find((entry) => entry.pane.id === selectedPaneId) ?? null;
  }, [allPanes, selectedPaneId]);

  useEffect(() => {
    if (!currentUser) {
      setSelectedPaneId(null);
      setLiveSnapshot(null);
      setLiveState('idle');
      return;
    }

    if (allPanes.length === 0) {
      setSelectedPaneId(null);
      setLiveSnapshot(null);
      setLiveState('idle');
      return;
    }

    if (!selectedPaneId || !allPanes.some((entry) => entry.pane.id === selectedPaneId)) {
      setSelectedPaneId(allPanes[0].pane.id);
    }
  }, [allPanes, currentUser, selectedPaneId]);

  useEffect(() => {
    if (!currentUser || !selectedPaneId) {
      return undefined;
    }

    setLiveState('connecting');

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

    const handleError = () => {
      setLiveState('error');
    };

    source.addEventListener('snapshot', handleSnapshot as EventListener);
    source.addEventListener('stream-error', handleStreamError as EventListener);
    source.onerror = handleError;

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
      setCommandDrafts({});
      setSelectedPaneId(null);
      setLiveSnapshot(null);
      setLiveState('idle');
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

  const sendCommand = async (paneId: string) => {
    const command = (commandDrafts[paneId] ?? '').trim();
    if (!command) {
      setStatus({ tone: 'destructive', message: '보낼 명령어를 입력해주세요.' });
      return;
    }

    setBusyKey(`command:${paneId}`);
    try {
      await apiRequest('/api/commands', {
        method: 'POST',
        body: JSON.stringify({
          targetPane: paneId,
          command,
          enter: true,
        }),
      });
      setCommandDrafts((current) => ({ ...current, [paneId]: '' }));
      setStatus({ tone: 'default', message: `${paneId} 패널에 명령어를 전송했습니다.` });
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
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <Card className="border border-border/70 bg-gradient-to-br from-card via-card to-primary/10">
            <CardHeader>
              <Badge variant="secondary" className="mb-2">
                인증 기반 원격 제어
              </Badge>
              <CardTitle className="text-3xl">tmux 웹 콘솔</CardTitle>
              <CardDescription className="max-w-2xl text-sm leading-6">
                브라우저에서 세션, 창, 패널을 확인하고 명령어를 보낼 수 있는 React + shadcn/ui 기반 관리 화면입니다.
                이제 API 토큰 대신 아이디/비밀번호 로그인과 HttpOnly 세션 쿠키를 사용합니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              <OverviewCard icon={MonitorSmartphone} label="접속 대상" value={health ? `${health.host}:${health.port}` : '확인 중'} />
              <OverviewCard icon={Shield} label="인증 방식" value="Credential 로그인" />
              <OverviewCard
                icon={Activity}
                label="실시간 스트림"
                value={health ? `${health.paneStreamIntervalMs}ms 주기` : '확인 중'}
              />
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
            <CardContent className="flex flex-col gap-3">
              <Badge variant={statusVariant}>{status.tone === 'destructive' ? '오류' : '안내'}</Badge>
              <p className="text-sm leading-6 text-muted-foreground">{status.message}</p>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <UserRound className="size-4" />
                {currentUser ? `${currentUser} 계정으로 로그인됨` : '로그인되지 않음'}
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
                <div className="grid gap-3">
                  <label className="flex flex-col gap-2 text-sm text-muted-foreground">
                    아이디
                    <Input value={loginUsername} onChange={(event) => setLoginUsername(event.target.value)} placeholder="예: admin" />
                  </label>
                  <label className="flex flex-col gap-2 text-sm text-muted-foreground">
                    비밀번호
                    <Input
                      type="password"
                      value={loginPassword}
                      onChange={(event) => setLoginPassword(event.target.value)}
                      placeholder="비밀번호 입력"
                    />
                  </label>
                </div>
                <Button onClick={() => void login()} disabled={busyKey === 'login'}>
                  {busyKey === 'login' ? <LoaderCircle className="size-4 animate-spin" /> : <LogIn className="size-4" />}
                  로그인
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>보안 메모</CardTitle>
                <CardDescription>현재 로그인 방식에서 알아두면 좋은 점입니다.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
                <p>로그인에 성공하면 JavaScript에서 읽을 수 없는 HttpOnly 세션 쿠키가 발급됩니다.</p>
                <p>운영 환경에서 HTTPS를 붙였다면 <code>COOKIE_SECURE=true</code> 로 Secure 쿠키를 꼭 켜는 것을 권장합니다.</p>
                <p>로그인 후에는 패널 출력을 실시간으로 확인할 수 있습니다.</p>
              </CardContent>
            </Card>
          </section>
        ) : (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard icon={SquareTerminal} label="세션" value={`${sessions.length}개`} detail="현재 불러온 tmux 세션 수" />
              <StatCard icon={PanelsTopLeft} label="창" value={`${totals.windows}개`} detail="모든 세션의 창 수 합계" />
              <StatCard icon={Command} label="패널" value={`${totals.panes}개`} detail="명령어를 보낼 수 있는 패널 수" />
              <StatCard icon={Activity} label="붙은 클라이언트" value={`${totals.attached}개`} detail="tmux에 현재 붙어 있는 클라이언트 수" />
            </section>

            <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
              <Card>
                <CardHeader>
                  <CardTitle>실시간 패널 보기</CardTitle>
                  <CardDescription>
                    선택한 패널의 최근 출력 {health?.paneHistoryLines ?? 200}줄을 {health?.paneStreamIntervalMs ?? 1000}ms 주기로 갱신합니다.
                  </CardDescription>
                  <CardAction>
                    <Badge variant={liveVariant}>
                      {liveState === 'live'
                        ? '실시간 연결 중'
                        : liveState === 'connecting'
                          ? '연결 중'
                          : liveState === 'error'
                            ? '연결 오류'
                            : '대기 중'}
                    </Badge>
                  </CardAction>
                </CardHeader>
                <CardContent className="space-y-4">
                  {selectedPaneMeta ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <Eye className="size-4" />
                        {selectedPaneMeta.sessionName} / {selectedPaneMeta.windowIndex}. {selectedPaneMeta.windowName} / {selectedPaneMeta.pane.id}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline">{selectedPaneMeta.pane.currentCommand || '셸'}</Badge>
                        <span>마지막 캡처: {formatCapturedAt(liveSnapshot?.capturedAt)}</span>
                        <span>줄 수: {liveSnapshot?.lineCount ?? 0}</span>
                      </div>
                      <div className="max-h-[28rem] overflow-auto rounded-xl border border-border/70 bg-black/70 p-4">
                        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-emerald-200">
                          {liveSnapshot?.content || '아직 표시할 출력이 없습니다.'}
                        </pre>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-xl border border-dashed border-border/80 p-6 text-sm text-muted-foreground">
                      실시간으로 볼 패널을 하나 선택해주세요.
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>로그인 정보</CardTitle>
                  <CardDescription>현재 로그인한 계정과 세션 상태입니다.</CardDescription>
                  <CardAction>
                    <Button variant="outline" size="sm" onClick={() => void logout()} disabled={busyKey === 'logout'}>
                      {busyKey === 'logout' ? <LoaderCircle className="size-4 animate-spin" /> : <LogOut className="size-4" />}
                      로그아웃
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                    <div className="mb-2 flex items-center gap-2 text-muted-foreground">
                      <UserRound className="size-4" /> 계정
                    </div>
                    <div className="text-lg font-semibold">{currentUser}</div>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">
                    세션 쿠키는 HttpOnly로 발급되며 브라우저 JavaScript에서는 직접 읽을 수 없습니다.
                  </p>
                </CardContent>
              </Card>
            </section>

            <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr_1fr]">
              <Card>
                <CardHeader>
                  <CardTitle>세션 만들기</CardTitle>
                  <CardDescription>새 tmux 세션을 즉시 생성합니다.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <Input
                    placeholder="예: dev-api"
                    value={sessionName}
                    onChange={(event) => setSessionName(event.target.value)}
                  />
                  <Button onClick={() => void createSession()} disabled={busyKey === 'create-session'}>
                    <Plus className="size-4" /> 세션 생성
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>창 만들기</CardTitle>
                  <CardDescription>기존 세션 안에 새 창을 추가합니다.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <Input
                    placeholder="세션 이름"
                    value={windowSessionName}
                    onChange={(event) => setWindowSessionName(event.target.value)}
                  />
                  <Input
                    placeholder="창 이름"
                    value={windowName}
                    onChange={(event) => setWindowName(event.target.value)}
                  />
                  <Button onClick={() => void createWindow()} disabled={busyKey === 'create-window'}>
                    <Plus className="size-4" /> 창 생성
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>실시간 보기 팁</CardTitle>
                  <CardDescription>패널 출력은 오른쪽 대시보드가 아니라 위 카드에서 집중해서 볼 수 있습니다.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
                  <p>각 패널 카드에서 <strong>실시간 보기</strong> 버튼을 누르면 위 라이브 뷰어가 해당 패널로 바뀝니다.</p>
                  <p>명령을 보내고 잠시 기다리면 같은 패널의 출력이 자동으로 갱신됩니다.</p>
                  <p>현재는 읽기 전용 라이브 뷰이며, 진짜 터미널 입력 포커스는 아직 별도 구현 전입니다.</p>
                </CardContent>
              </Card>
            </section>

            <section className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h2 className="text-2xl font-semibold">세션 목록</h2>
                <p className="text-sm text-muted-foreground">세션, 창, 패널 정보를 한 번에 보고 명령어를 바로 보낼 수 있습니다.</p>
              </div>

              {sessions.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-muted-foreground">
                    아직 표시할 세션이 없습니다. 새로고침하거나 새 세션을 만들어보세요.
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4">
                  {sessions.map((session) => (
                    <Card key={session.id} className="overflow-visible">
                      <CardHeader>
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <CardTitle className="text-xl">{session.name}</CardTitle>
                              <Badge variant="outline">창 {session.windows.length}개</Badge>
                              <Badge variant={session.attached > 0 ? 'default' : 'secondary'}>붙음 {session.attached}개</Badge>
                            </div>
                            <CardDescription>
                              세션 ID {session.id} · 원격으로 세션 종료, 창 생성, 패널 명령 전송이 가능합니다.
                            </CardDescription>
                          </div>
                          <Button
                            variant="destructive"
                            onClick={() => void killSession(session.name)}
                            disabled={busyKey === `kill:${session.name}`}
                          >
                            <Trash2 className="size-4" /> 세션 종료
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-4">
                        {session.windows.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-border/80 p-6 text-sm text-muted-foreground">
                            아직 창이 없습니다.
                          </div>
                        ) : (
                          session.windows.map((windowNode) => (
                            <div key={windowNode.id} className="rounded-2xl border border-border/80 bg-background/60 p-4">
                              <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="text-lg font-semibold">
                                      {windowNode.index}. {windowNode.name}
                                    </h3>
                                    {windowNode.active ? <Badge>활성 창</Badge> : <Badge variant="secondary">비활성 창</Badge>}
                                  </div>
                                  <p className="mt-1 text-sm text-muted-foreground">창 ID {windowNode.id} · 패널 {windowNode.panes.length}개</p>
                                </div>
                              </div>

                              <div className="grid gap-3 xl:grid-cols-2">
                                {windowNode.panes.map((pane, paneIndex) => {
                                  const isWatching = selectedPaneId === pane.id;
                                  return (
                                    <div key={pane.id} className="rounded-xl border border-border/70 bg-card/80 p-4">
                                      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                                        <div className="space-y-2">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-base font-semibold">패널 {pane.index}</span>
                                            {pane.active ? <Badge>활성 패널</Badge> : <Badge variant="secondary">대기 중</Badge>}
                                            {isWatching ? <Badge variant="outline">현재 보고 있음</Badge> : null}
                                          </div>
                                          <div className="space-y-1 text-sm text-muted-foreground">
                                            <div className="flex items-center gap-2">
                                              <Command className="size-4" /> {pane.currentCommand || '셸'}
                                            </div>
                                            <div className="flex items-center gap-2 break-all">
                                              <FolderOpen className="size-4" /> {pane.currentPath || '-'}
                                            </div>
                                            <div className="text-xs text-muted-foreground/90">{pane.title || pane.id}</div>
                                          </div>
                                        </div>
                                        <div className="flex flex-col items-end gap-2">
                                          <Badge variant="outline">{pane.id}</Badge>
                                          <Button variant={isWatching ? 'secondary' : 'outline'} size="sm" onClick={() => setSelectedPaneId(pane.id)}>
                                            <Play className="size-4" /> 실시간 보기
                                          </Button>
                                        </div>
                                      </div>

                                      <Separator className="mb-3" />

                                      <div className="flex flex-col gap-3">
                                        <Textarea
                                          placeholder="예: npm run dev"
                                          value={commandDrafts[pane.id] ?? ''}
                                          onChange={(event) =>
                                            setCommandDrafts((current) => ({
                                              ...current,
                                              [pane.id]: event.target.value,
                                            }))
                                          }
                                        />
                                        <div className="flex justify-end">
                                          <Button onClick={() => void sendCommand(pane.id)} disabled={busyKey === `command:${pane.id}`}>
                                            {busyKey === `command:${pane.id}` ? (
                                              <LoaderCircle className="size-4 animate-spin" />
                                            ) : (
                                              <Command className="size-4" />
                                            )}
                                            명령 전송
                                          </Button>
                                        </div>
                                      </div>

                                      {paneIndex < windowNode.panes.length - 1 ? <Separator className="mt-3 xl:hidden" /> : null}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </section>
          </>
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

type StatCardProps = {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
};

function StatCard({ icon: Icon, label, value, detail }: StatCardProps) {
  return (
    <Card size="sm">
      <CardContent className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="text-2xl font-semibold">{value}</div>
          <div className="text-xs leading-5 text-muted-foreground">{detail}</div>
        </div>
        <div className="rounded-xl border border-border/80 bg-background/70 p-2 text-primary">
          <Icon className="size-5" />
        </div>
      </CardContent>
    </Card>
  );
}

export default App;
