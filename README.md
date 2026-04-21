# tmux-web-console

Fastify API + React + shadcn/ui 기반의 tmux 원격 제어 콘솔입니다.

## 현재 구성

- **백엔드**: Fastify
- **프론트엔드**: React + Vite
- **UI**: shadcn/ui + Tailwind CSS v4
- **인증**: 아이디/비밀번호 로그인 + HttpOnly 세션 쿠키
- **tmux 브리지**: `execFile('tmux', args)` 기반

## 되는 것

- 로그인 / 로그아웃
- 세션 목록 조회
- 창/패널 구조 조회
- 세션 생성
- 창 생성
- 세션 종료
- 패널에 명령 전송
- 세션 쿠키 기반 원격 보호

## UI 특징

- 모든 주요 UI 문구를 **한글**로 제공
- shadcn/ui 카드형 대시보드
- 로그인 화면과 운영 화면 분리
- 세션 / 창 / 패널 구조를 한 화면에서 탐색
- 패널별 명령 전송 입력창 제공

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
CORS_ORIGIN=*
```

### 권장 사항

- 운영 환경에서는 `AUTH_PASSWORD` 를 강한 값으로 바꾸세요.
- 운영 환경에서는 `SESSION_SECRET` 를 충분히 긴 랜덤 문자열로 바꾸세요.
- HTTPS 뒤에서 운영할 때는 `COOKIE_SECURE=true` 를 권장합니다.

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
- `GET /api/sessions`
- `POST /api/sessions`
- `DELETE /api/sessions/:name`
- `POST /api/windows`
- `POST /api/commands`

## 쿠키 보안 메모

MDN의 `Set-Cookie` 가이드와 보안 쿠키 가이드를 따라, 현재 세션 쿠키는 기본적으로 다음 속성을 사용합니다.

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
- 패널 출력 실시간 스트리밍
- 계정 저장소/암호 해시/비밀번호 재설정 흐름

인터넷에 직접 노출하려면 위 항목을 추가하는 것이 좋습니다.
