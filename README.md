# tmux-web-console

Fastify API + React + shadcn/ui 기반의 tmux 원격 제어 콘솔입니다.

## 현재 구성

- **백엔드**: Fastify
- **프론트엔드**: React + Vite
- **UI**: shadcn/ui + Tailwind CSS v4
- **터미널 렌더링**: xterm.js + `@xterm/addon-fit` + `@xterm/addon-search`
- **인증**: 아이디/비밀번호 로그인 + HttpOnly 세션 쿠키
- **실시간 보기**: tmux pane 캡처 + SSE 스트리밍
- **tmux 브리지**: `execFile('tmux', args)` 기반

## 되는 것

- 로그인 / 로그아웃
- 좌측 세션/창/패널 트리 탐색
- 우측 xterm.js 터미널 보기
- 선택한 패널 출력 실시간 보기
- 선택한 패널에 직접 키 입력 전달
- 터미널 영역 크기 변경 시 tmux pane 크기 동기화
- 터미널 버퍼 검색 / 다음 / 이전 이동
- 세션 목록 조회
- 세션 생성
- 창 생성
- 세션 종료
- 선택 패널에 명령 전송
- 세션 쿠키 기반 원격 보호

## UI 특징

- 모든 주요 UI 문구를 **한글**로 제공
- 왼쪽은 **스크롤 가능한 세션 트리**, 오른쪽은 **고정된 터미널 작업 영역**
- xterm.js 기반 터미널 스타일 렌더링
- 선택한 패널 기준으로 정보/명령/관리 카드가 동작
- 긴 세션 목록 때문에 페이지 전체를 계속 스크롤하지 않도록 구조 변경
- 터미널 검색창 / 포커스 버튼 / 크기 표시 제공
- 최근 선택한 pane 탭바 제공

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
- `POST /api/panes/:paneId/input`
- `POST /api/panes/:paneId/resize`
- `GET /api/panes/:paneId/stream`
- `GET /api/sessions`
- `POST /api/sessions`
- `DELETE /api/sessions/:name`
- `POST /api/windows`
- `POST /api/commands`

## 라이브/터미널 동작 방식

- 서버는 `tmux capture-pane -e -p -J` 로 최근 패널 내용을 읽습니다.
- 브라우저는 `EventSource` 로 `/api/panes/:paneId/stream` 에 연결합니다.
- 내용이 바뀌면 새 스냅샷을 SSE로 밀어줍니다.
- 브라우저에서 입력한 키는 `/api/panes/:paneId/input` 으로 전달되어 `tmux send-keys` 로 주입됩니다.
- xterm 검색은 브라우저 버퍼를 대상으로 동작합니다.
- 터미널 박스 크기가 바뀌면 `/api/panes/:paneId/resize` 로 현재 cols/rows를 보내고, 서버는 `window-size manual` + `resize-window` + `resize-pane` 순으로 맞추려고 시도합니다.
- 현재 버전은 **xterm.js로 렌더링되는 읽기/입력 가능 패널 뷰**이며, PTY를 직접 붙인 완전한 브라우저 셸은 아닙니다.

## 쿠키 보안 메모

현재 세션 쿠키는 기본적으로 다음 속성을 사용합니다.

- `HttpOnly`
- `SameSite=Lax`
- `Path=/`
- `Max-Age=<SESSION_TTL_SECONDS>`
- `Secure` 는 `COOKIE_SECURE=true` 일 때만 활성화

HTTPS가 아닌 환경에서는 `Secure` 쿠키가 동작하지 않으므로 개발 환경 기본값은 `false` 입니다.
운영에서는 TLS를 붙인 뒤 `COOKIE_SECURE=true` 로 전환하는 것을 권장합니다.

## 보안/기술 메모

현재는 첫 단계라서 다음은 아직 미구현입니다.

- 사용자별 권한 분리
- TLS 종료 / 프록시 하드닝
- rate limiting
- 감사 로그
- PTY 직접 연결 기반의 완전한 인터랙티브 웹 터미널
- 계정 저장소/암호 해시/비밀번호 재설정 흐름

인터넷에 직접 노출하려면 위 항목을 추가하는 것이 좋습니다.
