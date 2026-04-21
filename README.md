# tmux-web-console

Fastify API + React + shadcn/ui 기반의 tmux 원격 제어 콘솔입니다.

## 현재 구성

- **백엔드**: Fastify
- **프론트엔드**: React + Vite
- **UI**: shadcn/ui + Tailwind CSS v4
- **인증**: 아이디/비밀번호 로그인 + HttpOnly 세션 쿠키
- **실시간 보기**: tmux pane 캡처 + SSE 스트리밍
- **tmux 브리지**: `execFile('tmux', args)` 기반

## 되는 것

- 로그인 / 로그아웃
- 세션 목록 조회
- 창/패널 구조 조회
- 세션 생성
- 창 생성
- 세션 종료
- 패널에 명령 전송
- 선택한 패널 출력 실시간 보기
- 세션 쿠키 기반 원격 보호

## UI 특징

- 모든 주요 UI 문구를 **한글**로 제공
- shadcn/ui 카드형 대시보드
- 로그인 화면과 운영 화면 분리
- 세션 / 창 / 패널 구조를 한 화면에서 탐색
- 패널별 명령 전송 입력창 제공
- 선택한 패널을 상단 라이브 뷰어에서 계속 추적

## 환경 변수

`.env.example` 값을 참고해서 실행 환경에 주입하세요.

```bash
HOST=0.0.0.0
PORT=4317
AUTH_USERNAME=admin
AUTH_PASSWORD=change-me
SESSION_SECRET=change-this-session-secret
SESSION_TTL_SECONDS=28800
COOKIE_SECURE=false
PANE_HISTORY_LINES=200
PANE_STREAM_INTERVAL_MS=1000
CORS_ORIGIN=*
```

### 권장 사항

- 운영 환경에서는 `AUTH_PASSWORD` 를 강한 값으로 바꾸세요.
- 운영 환경에서는 `SESSION_SECRET` 를 충분히 긴 랜덤 문자열로 바꾸세요.
- HTTPS 뒤에서 운영할 때는 `COOKIE_SECURE=true` 를 권장합니다.
- 패널 출력이 너무 길면 `PANE_HISTORY_LINES` 를 줄여 응답량을 조절하세요.

## 설치

```bash
npm install
```

## 개발 모드

백엔드:

```bash
npm run dev:server
```

프론트엔드:

```bash
npm run dev
```

Vite 개발 서버는 `/api` 요청을 `http://127.0.0.1:4317` 로 프록시합니다.

## 프로덕션 실행

```bash
HOST=0.0.0.0 \
PORT=4317 \
AUTH_USERNAME=admin \
AUTH_PASSWORD='change-me' \
SESSION_SECRET='replace-with-a-long-random-secret' \
COOKIE_SECURE=false \
PANE_HISTORY_LINES=200 \
PANE_STREAM_INTERVAL_MS=1000 \
npm start
```

`npm start` 전에 자동으로 프론트엔드 빌드를 수행합니다.

## 검증

```bash
npm test
npm run check
```

## 주요 엔드포인트

- `GET /api/health`
- `POST /api/login`
- `POST /api/logout`
- `GET /api/auth/me`
- `GET /api/tree`
- `GET /api/panes/:paneId`
- `GET /api/panes/:paneId/stream`
- `GET /api/sessions`
- `POST /api/sessions`
- `DELETE /api/sessions/:name`
- `POST /api/windows`
- `POST /api/commands`

## 라이브 뷰 동작 방식

- 서버는 `tmux capture-pane -p -J` 로 최근 패널 내용을 읽습니다.
- 브라우저는 `EventSource` 로 `/api/panes/:paneId/stream` 에 연결합니다.
- 내용이 바뀌면 새 스냅샷을 SSE로 밀어줍니다.
- 현재 버전은 **읽기 전용 실시간 뷰어**이며, xterm.js 기반의 진짜 터미널 에뮬레이터는 아직 아닙니다.

## 쿠키 보안 메모

현재 세션 쿠키는 기본적으로 다음 속성을 사용합니다.

- `HttpOnly`
- `SameSite=Lax`
- `Path=/`
- `Max-Age=<SESSION_TTL_SECONDS>`
- `Secure` 는 `COOKIE_SECURE=true` 일 때만 활성화

HTTPS가 아닌 환경에서는 `Secure` 쿠키가 동작하지 않으므로 개발 환경 기본값은 `false` 입니다.
운영에서는 TLS를 붙인 뒤 `COOKIE_SECURE=true` 로 전환하는 것을 권장합니다.

## 보안 메모

현재는 첫 단계라서 다음은 아직 미구현입니다.

- 사용자별 권한 분리
- TLS 종료 / 프록시 하드닝
- rate limiting
- 감사 로그
- 진짜 터미널 입력 포커스 / xterm.js 렌더링
- 계정 저장소/암호 해시/비밀번호 재설정 흐름

인터넷에 직접 노출하려면 위 항목을 추가하는 것이 좋습니다.
