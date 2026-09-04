# 증강 장기

한국 장기와 증강 카드를 결합한 로컬·온라인 2인 대국입니다.

온라인 대국은 6자리 방 코드로 연결되며 별도 계정이나 Firebase 로그인은 사용하지 않습니다. 방 상태와 대국은 Cloudflare D1에 저장되고, 로컬 대국 및 플레이테스트 통계는 현재 기기의 `localStorage`에 저장됩니다.

## 로컬 실행

Node.js 22.13 이상이 필요합니다.

```bash
npm ci
npx wrangler d1 migrations apply augment-janggi-db --local
npm run dev
```

터미널에 표시되는 로컬 주소(기본값 `http://localhost:3000`)를 브라우저에서 엽니다.

## 배포용 빌드 확인

```bash
npm test
npm run build
npm run start
```

- `npm test`: 프로덕션 빌드, 서버 렌더링, 카드 카탈로그, 게임 엔진 테스트를 실행합니다.
- `npm run build`: 배포 가능한 Vinext/Cloudflare Worker 번들을 `dist`에 생성합니다.
- `npm run start`: 생성한 프로덕션 번들을 로컬에서 확인합니다.

저장소에는 Firebase SDK, Firebase Authentication, 로그인 화면이 없습니다. 멀티플레이어의 방 토큰은 브라우저 `sessionStorage`에만 보관하며, D1에는 SHA-256 해시만 저장합니다.

## Cloudflare 직접 배포

이 프로젝트는 Cloudflare Workers + Static Assets + D1 구성입니다. 아래 명령은 프로젝트 루트에서 실행합니다.

1. Wrangler로 로그인하고 서울과 가까운 APAC 위치에 D1 데이터베이스를 만듭니다.

   ```bash
   npx wrangler login
   npx wrangler d1 create augment-janggi-db --location=apac
   ```

2. 출력된 `database_id`를 `wrangler.jsonc`의 `database_id`에 붙여 넣습니다. `binding`은 코드가 기대하는 `DB` 그대로 둡니다.

3. 방 테이블 마이그레이션을 원격 D1에 적용합니다.

   ```bash
   npx wrangler d1 migrations apply augment-janggi-db --remote
   ```

4. 검증·빌드 후 배포합니다.

   ```bash
   npm test
   npm run build
   npx wrangler deploy
   ```

`npm run build`가 Cloudflare Vite 플러그인용 배포 설정을 `dist/server/wrangler.json`에 생성하고, `npx wrangler deploy`가 그 설정을 따라 Worker와 정적 파일을 함께 올립니다. 재배포 때는 스키마 변경이 있다면 `npm run db:generate`로 마이그레이션을 만든 뒤 3~4단계를 반복합니다.

배포 후에는 서로 다른 두 브라우저 또는 시크릿 창에서 `방 만들기`와 `방 참여`를 열어 방 코드 입장, 양쪽 준비 완료, 첫 착수, 대국 종료 후 대기실 복귀를 확인합니다.

## 엔진 구조

```text
app/game/
  model.ts               상태 스키마, 명령, 이벤트, 저장 데이터 마이그레이션
  catalog.ts             74장 카드 카탈로그와 비용 계산
  engine.ts              공개 API와 명령 기반 상태 전이
  turn-pipeline.ts        행동 후 처리, 턴 전환, 판정, 드래프트 시점
  augment-registry.ts     예외적인 증강 효과 핸들러
  projection.ts           플레이어별 공개 상태 생성
  cards.json              데이터 기반 카드 정의
```

UI는 게임 상태를 직접 변경하지 않고 `reduceGame(state, command, actor)`에 명령을 전달합니다. 성공한 명령은 새 상태와 도메인 이벤트를 반환하며, 상태에는 `schemaVersion`, `rulesetVersion`, `revision`, 결정적 드래프트용 `rngSeed`가 기록됩니다.

## 아트 에셋

런타임에서 사용하는 SVG는 아래 네 경로로만 나뉩니다.

```text
public/board/     장기판
public/cards/     74장 카드 일러스트
public/effects/   도강, 방벽, 결박, 감염, 함정 효과
public/pieces/    기본 기물과 변신 기물
```

앱 코드는 각각 `/board`, `/cards`, `/effects`, `/pieces`의 루트 상대 URL로 참조합니다. 원본 생성기와 제작 문서는 `janggi-art-v7`에 보존하고, 브라우저에는 `public` 아래 완성 SVG만 제공합니다. 한은 빨강·해서체, 초는 초록·초서체로 표시하며, 도강과 상태 효과는 보드 위에 별도 레이어로 합성됩니다.

## 포함 범위

- 9×10 교차점 장기판과 마·상 멱, 포다리, 궁성 대각선 행마
- 궁 직접 포획 승리와 네 가지 마상 포진
- 시작·10수·20수 조건부 균형 드래프트
- 각자 10분, 착수 완료 시 3초 추가, 증강 선택자별 60초 타이머
- 자유포진을 제외한 카드 도감과 드로우 풀, 양쪽 공개 증강, 카드 상태, 누적 비용
- 6자리 방 코드 생성·입장, 방장 진영·증강 설정, 준비 완료, 서버 검증형 온라인 대국과 재대국
- 변신 증강의 대기·대상 선택·유효성 검증 흐름
- 50수 비용 판정과 8수 연장전 정체 판정
- 기보, 무르기, 다시 두기, 로컬 저장, 플레이테스트 통계
