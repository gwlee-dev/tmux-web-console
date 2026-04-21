import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Command,
  FolderOpen,
  LoaderCircle,
  MonitorSmartphone,
  PanelsTopLeft,
  Plus,
  RefreshCw,
  Shield,
  SquareTerminal,
  Trash2,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';

type StatusTone = 'default' | 'secondary' | 'destructive';

type HealthResponse = {
  ok: boolean;
  host: string;
  port: number;
  authRequired: boolean;
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

const TOKEN_STORAGE_KEY = 'tmux-web-console-api-token';

function getStoredToken() {
  return window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? '';
}

function summarizeError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return '알 수 없는 오류가 발생했습니다.';
}

async function parseResponse<T>(response: Response) {
  const contentType = response.headers.get('content-type') ?? '';
  const payload: unknown = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    if (typeof payload === 'string') {
      throw new Error(payload || `요청이 실패했습니다. (${response.status})`);
    }

    if (typeof payload === 'object' && payload !== null && 'error' in payload) {
      const message = payload.error;
      if (typeof message === 'string' && message.length > 0) {
        throw new Error(message);
      }
    }

    throw new Error(`요청이 실패했습니다. (${response.status})`);
  }

  return payload as T;
}

function App() {
  const [token, setToken] = useState(() => getStoredToken());
  const [draftToken, setDraftToken] = useState(() => getStoredToken());
  const [health, setHealth] = useState<HealthResponse | null>(null);
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
  const [commandDrafts, setCommandDrafts] = useState<Record<string, string>>({});

  const apiRequest = useCallback(
    async <T,>(path: string, init: RequestInit = {}, tokenOverride = token) => {
      const headers = new Headers(init.headers);
      if (init.body && !headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
      if (tokenOverride) {
        headers.set('x-api-token', tokenOverride);
      }

      const response = await fetch(path, {
        ...init,
        headers,
      });

      return parseResponse<T>(response);
    },
    [token],
  );

  const loadHealth = useCallback(async () => {
    const response = await fetch('/api/health');
    return parseResponse<HealthResponse>(response);
  }, []);

  const refreshData = useCallback(
    async (tokenOverride = token) => {
      setLoading(true);
      try {
        const healthPayload = await loadHealth();
        setHealth(healthPayload);

        const treePayload = await apiRequest<TreeResponse>('/api/tree', {}, tokenOverride);
        setSessions(treePayload.sessions);
        setStatus({
          tone: 'secondary',
          message: `${treePayload.sessions.length}개의 세션을 불러왔습니다.`,
        });
      } catch (error) {
        setSessions([]);
        setStatus({
          tone: 'destructive',
          message: summarizeError(error),
        });
      } finally {
        setLoading(false);
      }
    },
    [apiRequest, loadHealth, token],
  );

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

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

  const saveToken = async () => {
    const normalized = draftToken.trim();
    window.localStorage.setItem(TOKEN_STORAGE_KEY, normalized);
    setToken(normalized);
    setStatus({
      tone: 'secondary',
      message: normalized ? 'API 토큰을 저장했습니다. 다시 연결합니다.' : '저장된 토큰을 비웠습니다. 다시 연결합니다.',
    });
    await refreshData(normalized);
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

  return (
    <div className="dark min-h-svh bg-background text-foreground">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <Card className="border border-border/70 bg-gradient-to-br from-card via-card to-primary/10">
            <CardHeader>
              <Badge variant="secondary" className="mb-2">원격 제어 대시보드</Badge>
              <CardTitle className="text-3xl">tmux 웹 콘솔</CardTitle>
              <CardDescription className="max-w-2xl text-sm leading-6">
                브라우저에서 세션, 창, 패널을 확인하고 명령어를 바로 보낼 수 있는 React + shadcn/ui 기반 관리 화면입니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <div className="mb-2 flex items-center gap-2 text-muted-foreground">
                  <MonitorSmartphone className="size-4" /> 접속 대상
                </div>
                <div className="text-lg font-semibold">
                  {health ? `${health.host}:${health.port}` : '확인 중'}
                </div>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <div className="mb-2 flex items-center gap-2 text-muted-foreground">
                  <Shield className="size-4" /> 인증
                </div>
                <div className="text-lg font-semibold">{health?.authRequired ? '토큰 필요' : '로컬만 허용'}</div>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <div className="mb-2 flex items-center gap-2 text-muted-foreground">
                  <Activity className="size-4" /> 상태
                </div>
                <div className="text-lg font-semibold">{loading ? '동기화 중' : '준비 완료'}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>알림</CardTitle>
              <CardDescription>현재 연결 상태와 마지막 작업 결과를 보여줍니다.</CardDescription>
              <CardAction>
                <Button variant="outline" size="sm" onClick={() => void refreshData()} disabled={loading}>
                  {loading ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  새로고침
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Badge variant={status.tone === 'destructive' ? 'destructive' : status.tone === 'default' ? 'default' : 'secondary'}>
                {status.tone === 'destructive' ? '오류' : '안내'}
              </Badge>
              <p className="text-sm leading-6 text-muted-foreground">{status.message}</p>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={SquareTerminal} label="세션" value={`${sessions.length}개`} detail="현재 불러온 tmux 세션 수" />
          <StatCard icon={PanelsTopLeft} label="창" value={`${totals.windows}개`} detail="모든 세션의 창 수 합계" />
          <StatCard icon={Command} label="패널" value={`${totals.panes}개`} detail="명령어를 보낼 수 있는 패널 수" />
          <StatCard icon={Activity} label="붙은 클라이언트" value={`${totals.attached}개`} detail="tmux에 현재 붙어 있는 클라이언트 수" />
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>연결 설정</CardTitle>
              <CardDescription>원격으로 접속할 때 사용할 API 토큰을 저장합니다.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <label className="flex flex-col gap-2 text-sm text-muted-foreground">
                API 토큰
                <Input
                  type="password"
                  placeholder="예: change-me"
                  value={draftToken}
                  onChange={(event) => setDraftToken(event.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void saveToken()}>토큰 저장 및 다시 연결</Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setDraftToken('');
                    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
                    setToken('');
                    void refreshData('');
                  }}
                >
                  저장된 토큰 지우기
                </Button>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                토큰은 브라우저의 localStorage에만 저장됩니다. 외부 공개 환경이라면 TLS와 더 강한 인증을 추가하세요.
              </p>
            </CardContent>
          </Card>

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
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-2xl font-semibold">세션 목록</h2>
            <p className="text-sm text-muted-foreground">세션, 창, 패널 정보를 한 번에 보고 명령어를 바로 보낼 수 있습니다.</p>
          </div>

          {sessions.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                아직 표시할 세션이 없습니다. 토큰을 확인하고 새로고침하거나, 새 세션을 만들어보세요.
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
                            {windowNode.panes.map((pane, paneIndex) => (
                              <div key={pane.id} className="rounded-xl border border-border/70 bg-card/80 p-4">
                                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                                  <div className="space-y-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-base font-semibold">패널 {pane.index}</span>
                                      {pane.active ? <Badge>활성 패널</Badge> : <Badge variant="secondary">대기 중</Badge>}
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
                                  <Badge variant="outline">{pane.id}</Badge>
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
                            ))}
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
      </div>
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
