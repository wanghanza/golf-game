# Golf Swing Reader Game

스마트폰을 골프채처럼 쥐고 가볍게 스윙하면, 휴대폰의 가속도계·자이로스코프 값을 분석해 3D 연습장에서 공이 날아가는 게임입니다. 모든 계산은 휴대폰에서 하고, TV는 Smart View 화면 미러링으로 보여 주기만 합니다.

> 스마트폰 센서로는 클럽 헤드 속도·페이스 각·공 스핀을 직접 측정할 수 없습니다. 앱에 표시되는 볼 스피드·스핀·비거리는 **가상 클럽 모델의 추정값**이며, 화면에 `측정 / 측정유래 / 추정` 태그로 구분해 표시합니다.

## 설치 (안드로이드)

1. 이 저장소의 **Releases**에서 최신 `개발 빌드` 프리릴리스를 열고 `GolfSwingReader-dev-*.apk`를 내려받습니다.
   (또는 Actions → 최신 "Build & test" 실행 → Artifacts → `apk`)
2. 휴대폰에서 APK를 열고, "출처를 알 수 없는 앱 설치"를 허용합니다.
3. 앱 이름: **Golf Swing Reader** (패키지 `com.wanghanza.golfswingreader.dev`)

모든 CI 빌드는 같은 개발용 키로 서명하므로, 새 APK를 기존 앱 위에 그대로 덮어 설치할 수 있습니다.

## 사용법

| 모드 | 내용 |
|---|---|
| 코스 라운드 · 18홀 | **단풍 바다 CC**: 바다가 내려다보이는 가을 산악 코스(파 72, 6,055 m). 홀 미리보기 비행, 클럽 자동 추천, 조준 ◀ ▶, 체감 거리(고저차 반영), 바람, 벙커·러프·숲 라이, 바다 해저드(1벌타), 퍼팅(작은 스윙), 컨시드, 스코어카드 |
| 연습장 (스윙 게임) | 클럽 선택 → 스윙 준비 → 어드레스 자세로 정지(0.4초) → 스윙 → 공 발사. 화면 터치는 잠기며, 1초 길게 눌러 해제합니다. |
| 시뮬레이션 테스트 | 합성 스윙 10종, 저장된 기록, CSV 파일을 불러와 구간 판정을 확인하고 3D로 발사합니다. 사람이 직접 휘두르지 않아도 테스트할 수 있습니다. |
| 센서 분석·수집 | 6축 실시간 그래프와 실측 Hz를 보여 줍니다. 수동 기록과 자동 스윙 감지 저장, 기록 보기·재생·삭제, CSV+JSON 내보내기(Download/GolfSwingReader)를 지원합니다. |
| 설정 | 클럽, m/yd 단위, 센서 속도, 게임 보정값(감도, 실력, 방향 보정, 페이스·경로 계수, 부호 반전) |
| 안전 안내 / TV 연결 안내 | 손목 스트랩과 주변 공간 안내, LG TV Smart View 연결 방법 |

## 저장소 구조

```
course-engine/    18홀 코스: 지형(산·바다), 홀 배치, 지면 판정, 라운드 규칙(타수·벌타·퍼팅·스코어)
swing-engine/     스윙 분석 엔진 (전처리, 자세, 구간, 가상 임팩트, 특징, 유효성, 실시간 감지, CSV/JSON)
physics-engine/   공 비행 물리 (RK4, 항력·양력·스핀, 바운스·구름, 클럽 모델, D-plane, 게임 보정 분리)
data-tools/       합성 센서 데이터 생성기 + 샘플 생성 CLI
sample-data/      합성 스윙 기록 10종 (synthetic: true, 실측 아님)
web-game/         Vite + Three.js 게임 UI (브라우저와 APK에서 공용)
android-app/      Kotlin WebView 호스트 + 200 Hz 네이티브 센서 브리지
data-research/    공개 데이터 조사·분석 (REPORT.md, CaddieSet 분석, 물리 비교)
docs/             기술 설계, 실사용 검증·데이터 수집 계획
.github/workflows 자동 테스트, APK 빌드, 개발 프리릴리스
```

## 개발

```bash
npm ci
npm test                 # 엔진 단위 테스트 (node --test)
npm run dev              # 브라우저 개발 서버 (센서 없는 PC에서는 "샘플 스윙" 사용)
npm run build:web        # web-game/dist
cd android-app && ./gradlew testDebugUnitTest assembleDebug   # Android SDK 필요
npm run samples          # sample-data 재생성
```

공개 데이터 분석은 `data-research/REPORT.md`, 설계는 `docs/TECHNICAL.md`, 다음 검증 단계는 `docs/DATA_COLLECTION_PLAN.md`에 있습니다.

## 사용한 외부 자료
- three.js (MIT), Vite (MIT)
- CaddieSet (MIT): 분석용으로만 사용했고, 원본은 저장소에 포함하지 않았습니다.
- TrackMan 투어 평균 수치(공개 자료): 클럽 기준점과 물리 계수 맞춤에 사용
- MultiSenseGolf 코드(MIT)와 GolfDB(CC BY-NC 4.0): 설계 참고만 했고, 코드·데이터를 포함하지 않았습니다.
