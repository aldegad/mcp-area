# mcp-arena (prototype)

Firebase Hosting + Functions + Firestore + Storage 기반의 MCP 연동 로봇 배틀 프로토타입입니다. (TypeScript)

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

## 에이전트 응답 매너 메모

- 기본적으로 존댓말로 응답합니다.
- 사용자가 승인/허락/협업 제안을 해주면 감사 인사를 명시합니다. (`감사합니다.`)
- 말투는 간결하게 유지하되, 실행 결과와 근거는 분명하게 전달합니다.

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
│  │     ├─ index.ts         # REST + MCP endpoint (consultative tools 포함)
│  │     ├─ parser.ts        # 로봇 스크립트 DSL parser
│  │     └─ battleEngine.ts  # 전투 엔진 + replay timeline 생성
│  ├─ web/
│  │  ├─ app/
│  │  │  ├─ page.tsx
│  │  │  └─ globals.css
│  │  ├─ components/
│  │  │  └─ ArenaReplay.tsx  # 캔버스 리플레이
│  │  └─ .env.local          # 로컬 API base
│  └─ mcp-bridge/
│     ├─ index.ts            # stdio MCP bridge source
│     └─ index.js            # 실행 엔트리 (dist 로더)
├─ .mcp.json
├─ firebase.json
├─ firestore.rules
└─ storage.rules
```

## parser.js DSL

한 줄에 한 규칙(매 틱 전체 규칙을 위에서 아래로 평가):

- `SET THROTTLE <-1..1>`: 전/후진 입력 (`+` 전진, `-` 후진)
- `SET STRAFE <-1..1>`: 좌/우 횡이동 입력 (`+` 우, `-` 좌)
- `SET TURN <-1..1>`: 좌/우 회전 입력 (`+` 우회전, `-` 좌회전)
- `FIRE` 또는 `FIRE ON|OFF`: 사격 트리거 (에너지 소모)
- `BOOST LEFT|RIGHT`: 에너지를 소모해 좌/우 횡부스터 대시
- `IF ENEMY_VISIBLE THEN <COMMAND>`
- `IF NOT ENEMY_VISIBLE THEN <COMMAND>`
- `IF <EXPR> <OP> <EXPR> THEN <COMMAND>`
- `IF (<COND>) AND (<COND>) THEN <COMMAND>`
- `IF (<COND>) OR (<COND>) THEN <COMMAND>`
- `IF NOT (<COND>) THEN <COMMAND>`
  - 센서: `ARENA_SIZE`, `SELF_X`, `SELF_Y`, `SELF_HEADING`, `SELF_ENERGY`, `BOOST_COOLDOWN`, `TICKS_SINCE_ENEMY_SEEN`, `ENEMY_X`, `ENEMY_Y`, `ENEMY_HEADING`, `ENEMY_DX`, `ENEMY_DY`, `ENEMY_DISTANCE`, `PREV_ENEMY_X`, `PREV_ENEMY_Y`, `PREV_ENEMY_HEADING`, `PREV_ENEMY_DX`, `PREV_ENEMY_DY`, `PREV_ENEMY_DISTANCE`, `ENEMY_DX_DELTA`, `ENEMY_DY_DELTA`, `ENEMY_DISTANCE_DELTA`, `WALL_AHEAD_DISTANCE`, `WALL_LEFT_DISTANCE`, `WALL_RIGHT_DISTANCE`, `WALL_BACK_DISTANCE`, `WALL_NEAREST_DISTANCE`
  - 수식: `+`, `-`, `*`, `/`, `()`, 상수 `PI`, `TAU`
  - 함수: `ATAN2(y, x)`, `ANGLE_DIFF(targetDeg, currentDeg)`, `NORMALIZE_ANGLE(angleDeg)`, `ABS(x)`, `MIN(a,b)`, `MAX(a,b)`, `CLAMP(x,min,max)`
  - 비교 연산자: `>`, `>=`, `<`, `<=`, `==`, `!=`
  - 논리 연산자: `AND`, `OR`, `NOT` (괄호 우선순위 지원)
- `#` 주석

예시:

```txt
SET THROTTLE 0.7
SET STRAFE 0.15
SET TURN 0.2
FIRE OFF
IF ANGLE_DIFF(ATAN2(ENEMY_DY, ENEMY_DX), SELF_HEADING) > 4 THEN SET TURN 1
IF ANGLE_DIFF(ATAN2(ENEMY_DY, ENEMY_DX), SELF_HEADING) < -4 THEN SET TURN -1
IF ENEMY_DISTANCE < 1.8 THEN SET THROTTLE -0.6
IF ENEMY_VISIBLE THEN FIRE ON
```

## 자동 시야 규칙

- 매 틱 자동으로 시야 정보가 갱신됩니다 (별도 `SCAN` 불필요)
- 시야 범위: 전방 반원, 반경 8칸
- 총 사거리: 전방 5칸 (시야와 별도)
- 시야 데이터: `enemyVisible`, `enemy.dx`, `enemy.dy`, `enemy.distance`, `enemy.bearing`, `enemy.headingDeg`, `enemy.headingDirection`, `wall.aheadDistance`, `wall.leftDistance`, `wall.rightDistance`, `wall.backDistance`, `wall.sightArc(leftEdge/center/rightEdge)`
- 배틀 로그(`timeline`)에도 각 액션의 `perceptionBefore`/`perceptionAfter`가 포함됩니다.

## 실시간 틱 규칙

- 전투는 턴제가 아니라 **실시간 틱** 기반으로 진행됩니다.
- 이동/회전/사격 입력은 같은 틱에 중복 적용됩니다.
- 이동 속도 우선순위: 전진(빠름) > 횡이동(중간) > 후진(느림)
- `FIRE ON` 상태에서는 이동 속도와 회전 속도가 각각 절반으로 감소합니다.
- 사격은 쿨다운 1틱 개념이며(실질적으로 매 틱 발사 가능), 에너지(`SELF_ENERGY`)를 소모합니다.
- 발사체는 즉시 명중하지 않고 비행 시간을 가집니다(현재 `2틱/칸`, 사거리 5칸이면 최대 약 10틱 비행).
- 사이드 부스터(`BOOST LEFT|RIGHT`)는 발동 후 5틱 동안 `5→4→3→2→1` 강제 횡이동(총 15틱 분량)을 수행합니다.
- 사이드 부스터는 에너지(`SELF_ENERGY`)를 소모하고 쿨다운(`BOOST_COOLDOWN`, 10틱)을 사용합니다.

## API

기본 경로: `/api`

- `GET /api/health`
- `GET /api/robots`
- `POST /api/robots`
- `GET /api/robots/:robotId/avatar` (업로드된 SVG 로봇 이미지)
- `POST /api/battles`
- `GET /api/battles/:battleId`
- `POST /api/mcp` (JSON-RPC)

배틀 결과에는 리플레이용 데이터가 포함됩니다.

- `maxTicks`
- `tickDurationMs`
- `projectileTiming`
- `movementTiming`
- `initialState`
- `timeline` (액션별 `before`/`after`, 탄환 궤적)
- `ticks` (`turns`는 하위호환 alias)
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
  - 서버 모드에서는 `opponentScript`를 직접 넣어야 하며 preset 상대는 제공되지 않음
- `upload_robot_script`
  - 최종 로봇 업로드
  - 선택적으로 `robotImageSvg`(SVG 문자열)를 함께 전달해 로봇 전용 이미지를 저장 가능
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

로컬 테스트용 preset 상대:

- `preview_robot_duel`의 preset 상대는 로컬 에뮬레이터(`FUNCTIONS_EMULATOR=true`)에서만 허용됩니다.
- 필요하면 `MCP_ARENA_ENABLE_PRESETS=1`로 명시 활성화할 수 있습니다.

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
- 실시간 틱 단위로 명령 실행
- 전방 8칸 자동 시야 갱신
- 총 사거리 5칸
- 이동 속도: 전진(`THROTTLE>0`) > `STRAFE` > 후진(`THROTTLE<0`)
- 사격: 쿨다운 1틱 개념(실질 매틱 발사 가능) + 공용 에너지 소모
- 투사체: 발사 후 틱 단위 비행(즉시 명중 아님, 회피 가능)
- 사이드 부스터: `BOOST LEFT|RIGHT` (5틱 강제 횡이동 + 에너지/10틱 쿨다운)
- 조건 분기(`IF ... THEN`) + 수식 비교 + 논리 연산(`AND/OR/NOT`) + 관측 메모리 센서 지원
- `FIRE` 적중 시 즉시 사망
- 승자 없으면 `draw`

## 주의

현재 `firestore.rules`, `storage.rules`는 프로토타입용 전체 허용입니다. 실제 서비스 전에는 인증/권한 규칙을 반드시 강화해야 합니다.
