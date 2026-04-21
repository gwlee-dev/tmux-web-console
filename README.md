# tmux-web-console

Fastify API + React + shadcn/ui 기반의 tmux 원격 제어 콘솔입니다.

## 현재 구성

- **백엔드**: Fastify
- **프론트엔드**: React + Vite
- **UI**: shadcn/ui + Tailwind CSS v4
- **tmux 브리지**: `execFile('tmux', args)` 기반

## 되는 것

- 세션 목록 조회
- 창/패널 구조 조회
- 세션 생성
- 창 생성
- 세션 종료
- 패널에 명령 전송
- API 토큰 기반 원격 보호

## UI 특징

- 모든 주요 UI 문구를 **한글**로 제공
- shadcn/ui 카드형 대시보드
- 세션 / 창 / 패널 구조를 한 화면에서 탐색
- 패널별 명령 전송 입력창 제공

## 환경 변수

`.env.example` 값을 참고해서 실행 환경에 주입하세요.

```bash
HOST=0.0.0.0
PORT=4317
API_TOKEN=change-me
CORS_ORIGIN=*
```

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
HOST=0.0.0.0 PORT=4317 API_TOKEN=change-me npm start
```

`npm start` 전에 자동으로 프론트엔드 빌드를 수행합니다.

## 검증

```bash
npm test
npm run check
```

## 주요 엔드포인트

- `GET /api/health`
- `GET /api/tree`
- `GET /api/sessions`
- `POST /api/sessions`
- `DELETE /api/sessions/:name`
- `POST /api/windows`
- `POST /api/commands`

## 보안 메모

현재는 첫 단계라서 다음은 아직 미구현입니다.

- 사용자 계정 기반 인증
- TLS 종료 / 프록시 하드닝
- rate limiting
- 감사 로그
- 패널 출력 실시간 스트리밍

인터넷에 직접 노출하려면 위 항목을 추가하는 것이 좋습니다.
