# mcp-arena (prototype)

Firebase Hosting + Functions + Firestore + Storage 기반의 MCP 연동 로봇 배틀 프로토타입입니다.

## 핵심 아이디어

사람은 에이전트에게 이렇게 말합니다.

- `"mcp arena에 ai 로봇 만들어서 업로드해줘"`

그러면 에이전트가 MCP 툴 체인을 사용해 다음 순서로 진행합니다.

1. 상담 플로우 확인 (`get_build_flow`)
2. 전략/스크립트 초안 생성 (`coach_robot_design`)
3. 사용자에게 부족한 정보 질문 (playStyle/risk/objective)
4. 스크립트 검증 (`validate_robot_script`)
5. 프리뷰 대전 (`preview_robot_duel`)
6. 사용자 승인 후 최종 업로드 (`upload_robot_script`)

즉, 단순 업로드가 아니라 **전술 상담 -> 검증 -> 시뮬레이션 -> 업로드**를 MCP 안에서 지원합니다.

## 구성

- 모노레포(`yarn workspaces`)
- `apps/web`: Next.js 프론트엔드(로봇 업로드, 배틀 실행, 캔버스 리플레이)
- `apps/functions`: Firebase Functions API + MCP(JSON-RPC)
- `apps/mcp-bridge`: stdio MCP 브리지(에이전트 연결용)
- Firestore: 로봇/배틀 메타데이터 저장
- Storage: 로봇 원본 스크립트 저장

## 디렉터리

```text
.
├─ apps/
│  ├─ functions/
│  │  └─ src/
│  │     ├─ index.js         # REST + MCP endpoint (consultative tools 포함)
│  │     ├─ parser.js        # 로봇 스크립트 DSL parser
│  │     └─ battleEngine.js  # 전투 엔진 + replay timeline 생성
│  ├─ web/
│  │  ├─ app/
│  │  │  ├─ page.js
│  │  │  └─ globals.css
│  │  ├─ components/
│  │  │  └─ ArenaReplay.js   # 캔버스 리플레이
│  │  └─ .env.local          # 로컬 API base
│  └─ mcp-bridge/
│     └─ index.js            # stdio MCP bridge
├─ .mcp.json
├─ firebase.json
├─ firestore.rules
└─ storage.rules
```

## parser.js DSL

한 줄에 한 명령:

- `MOVE <1-3>`: 전진
- `ROTATE LEFT|RIGHT|NONE` (또는 `ROTATE 0`)
- `SHOOT`: 전방 5칸 시야 + 직선 사선이 맞으면 타격(원샷킬)
- `WAIT`
- `IF_SEEN <MOVE|ROTATE|SHOOT|WAIT ...>`: 적이 보일 때만 실행
- `IF_NOT_SEEN <MOVE|ROTATE|SHOOT|WAIT ...>`: 적이 안 보일 때만 실행
- `#` 주석

예시:

```txt
IF_SEEN SHOOT
MOVE 1
IF_NOT_SEEN ROTATE RIGHT
IF_SEEN SHOOT
WAIT
```

## 자동 시야 규칙

- 매 턴 자동으로 시야 정보가 갱신됩니다 (별도 `SCAN` 불필요)
- 시야 범위: 전방 반원, 반경 5칸
- 시야 데이터: `enemyVisible`, `enemy.dx`, `enemy.dy`, `enemy.distance`, `enemy.bearing`
- 배틀 로그(`timeline`)에도 각 액션의 `perceptionBefore`/`perceptionAfter`가 포함됩니다.

## API

기본 경로: `/api`

- `GET /api/health`
- `GET /api/robots`
- `POST /api/robots`
- `POST /api/battles`
- `GET /api/battles/:battleId`
- `POST /api/mcp` (JSON-RPC)

배틀 결과에는 리플레이용 데이터가 포함됩니다.

- `initialState`
- `timeline` (액션별 `before`/`after`, 탄환 궤적)
- `turns`
- `finalState`

## MCP 툴 목록 (상담형)

- `get_build_flow`
  - 에이전트가 사람과 어떤 순서로 상담할지 안내
- `coach_robot_design`
  - 사람의 의도/성향을 받아 로봇 초안(규칙+스크립트) 생성
  - 부족 정보가 있으면 `followUpQuestions` 반환
- `validate_robot_script`
  - DSL 문법 + 전술 품질 체크(경고/추천)
- `preview_robot_duel`
  - 후보 스크립트를 프리뷰 배틀로 점검
- `upload_robot_script`
  - 최종 로봇 업로드
  - `userApprovalConfirmed=true`가 아니면 업로드가 차단됨(최종 사용자 승인 강제)

## 로컬 실행 (Emulator)

현재 기본 로컬 ID:

- `.firebaserc` -> `mcp-arena-local`

웹 API:

- `apps/web/.env.local`
  - `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:5001/mcp-arena-local/us-central1/api`

실행:

```bash
yarn install
yarn emulators
```

별도 터미널:

```bash
yarn dev:web
```

브라우저 `http://localhost:3000`:

1. 로봇 2개 이상 업로드
2. 배틀 실행
3. Replay 재생/프레임 이동

## Agent 연결용 MCP 브리지 (stdio)

에이전트는 stdio MCP 서버를 사용하므로 브리지를 연결합니다.

```bash
yarn dev:mcp-bridge
```

기본 포워딩 대상:

- `http://127.0.0.1:5001/mcp-arena-local/us-central1/api/mcp`

원격 배포 API로 전환:

```bash
MCP_ARENA_API_BASE_URL=https://<region>-<project-id>.cloudfunctions.net/api yarn dev:mcp-bridge
```

## Claude / Codex 등록 예시

### Claude Code

```bash
claude mcp add mcp-arena node /ABSOLUTE/PATH/mcp-arena/apps/mcp-bridge/index.js
```

### Codex CLI

```bash
codex mcp add mcp-arena --env MCP_ARENA_API_BASE_URL=http://127.0.0.1:5001/mcp-arena-local/us-central1/api -- node /ABSOLUTE/PATH/mcp-arena/apps/mcp-bridge/index.js
```

## 에이전트에게 줄 사용자 프롬프트 예시

```text
mcp arena에 ai 로봇을 만들어 업로드해줘.
내 성향은 공격적이지만 너무 운빨은 싫어.
최종 업로드 전에 스크립트 검증하고 프리뷰 대전 결과도 보여줘.
```

이렇게 요청하면 에이전트는 보통 아래 방식으로 진행합니다.

1. `get_build_flow` 확인
2. `coach_robot_design`으로 초안 생성
3. 사용자에게 follow-up 질문
4. `validate_robot_script`
5. `preview_robot_duel`
6. 사용자 승인 후 `upload_robot_script`

## 배포 가이드

### 1) 실제 Firebase 프로젝트로 전환

- `.firebaserc`의 `default`를 실제 프로젝트 ID로 변경
- `apps/web/.env.local`의 API URL을 배포 URL로 변경

예시:

```bash
NEXT_PUBLIC_API_BASE_URL=https://<region>-<project-id>.cloudfunctions.net/api
```

### 2) 웹 빌드 + 배포

```bash
yarn build:web
firebase deploy --only hosting,functions,firestore,storage
```

배포 후 MCP 브리지도 같은 URL로 연결해 사용합니다.

## 라이선스

이 프로젝트는 `PolyForm Noncommercial 1.0.0` 라이선스를 따릅니다.

- 코드 다운로드/실행/수정/비상업적 배포: 허용
- 상업적 이용: 금지

자세한 내용은 루트 `LICENSE` 파일을 확인하세요.

## 현재 규칙

- 정사각형 아레나
- 로봇 2대
- 시작 위치 `(0,0)` vs `(N-1,N-1)`
- 명령 루프 실행
- 전방 5칸 자동 시야 갱신
- 조건 분기(`IF_SEEN`, `IF_NOT_SEEN`) 지원
- `SHOOT` 적중 시 즉시 사망
- 승자 없으면 `draw`

## 주의

현재 `firestore.rules`, `storage.rules`는 프로토타입용 전체 허용입니다. 실제 서비스 전에는 인증/권한 규칙을 반드시 강화해야 합니다.
