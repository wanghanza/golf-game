// Home, settings, safety and TV-mirroring screens.
import { h } from '../util.js';
import { settings, saveSettings, DEFAULT_SETTINGS } from '../settings.js';
import { PLAYER_LEVELS } from '../../../physics-engine/src/game-config.js';
import { CLUBS, CLUB_ORDER } from '../../../physics-engine/src/clubs.js';
import { isAndroidApp } from '../platform.js';
import { COURSES, COURSE_ORDER } from '../../../course-engine/src/courses/index.js';

export function createHomeScreen(app) {
  const el = h(`
  <section class="home" id="screen-home">
    <h1>⛳ Golf Swing Reader</h1>
    <p class="sub">휴대폰을 골프채처럼 쥐고 가볍게 스윙하면 센서 값으로 공이 날아갑니다 · ${isAndroidApp() ? '안드로이드 앱' : '웹 버전'}</p>
    <div class="menu">
${COURSE_ORDER.map((id, i) => `      <button class="${i === 0 ? 'primary' : 'primary alt'}" data-go="round" data-course="${id}"><b>코스 라운드 · ${COURSES[id].name}</b><span>${COURSES[id].subtitle}</span></button>`).join('\n')}
      <button data-go="game"><b>연습장</b><span>휴대폰을 휘둘러 3D 연습장에서 샷</span></button>
      <button data-go="simulate"><b>시뮬레이션 테스트</b><span>저장·합성 데이터로 스윙 재현 후 발사</span></button>
      <button data-go="recorder"><b>센서 분석 · 수집</b><span>6축 센서 그래프, 기록, CSV/JSON 내보내기</span></button>
      <button data-go="settings"><b>설정</b><span>클럽, 감도, 단위, 게임 보정값</span></button>
      <button data-go="safety"><b>안전 안내</b><span>스윙 전에 꼭 읽어 주세요</span></button>
      <button data-go="tv"><b>TV 연결 안내</b><span>LG TV에 화면 미러링 (Smart View)</span></button>
    </div>
    <div class="foot">스마트폰 센서로는 클럽 헤드 속도·페이스 각·공 스핀을 직접 측정할 수 없습니다. 화면의 볼 스피드·스핀·비거리는 가상 클럽 모델의 추정값입니다.</div>
  </section>`);
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-go]');
    if (btn) app.show(btn.dataset.go, btn.dataset.course ? { course: btn.dataset.course } : undefined);
  });
  return { el, enter() {}, leave() {} };
}

export function createSettingsScreen(app) {
  const el = h(`
  <section class="screen" id="screen-settings">
    <div class="topbar"><button data-act="back">← 메뉴</button><span class="title">설정</span></div>
    <div class="scroll-page"><div class="doc stack">
      <div class="card stack">
        <h3>기본</h3>
        <label>클럽</label>
        <select data-k="club">${CLUB_ORDER.map((k) => `<option value="${k}">${CLUBS[k].label}</option>`).join('')}</select>
        <label>거리 단위</label>
        <select data-k="units"><option value="m">미터 (m)</option><option value="yd">야드 (yd)</option></select>
        <label>어드레스 정지 시간 (초)</label>
        <select data-k="addressSeconds"><option value="2">2초</option><option value="3">3초 (기본)</option><option value="4">4초</option><option value="5">5초</option></select>
        <label><input type="checkbox" data-k="swingDirectionFlip" /> 스윙 방향 반전 (화면을 목표 반대쪽으로 쥐는 경우)</label>
        <label>센서 요청 속도</label>
        <select data-k="sensorRateHz"><option value="100">100 Hz</option><option value="200">200 Hz</option></select>
      </div>
      <div class="card stack">
        <h3>게임 보정값 <span class="tag estimated">측정값 아님</span></h3>
        <div class="muted">휴대폰 움직임을 가상 클럽으로 바꾸는 게임 규칙입니다. 물리 엔진과 분리되어 있습니다.</div>
        <label>실력 단계 (100% 파워 시 클럽 스피드)</label>
        <select data-g="playerLevel">${Object.entries(PLAYER_LEVELS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>
        <label>스윙 감도: 100% 파워 기준 각속도 <b data-v="referenceOmega"></b> rad/s (낮을수록 작은 스윙으로 멀리)</label>
        <input type="range" min="5" max="20" step="0.5" data-g="referenceOmega" />
        <label>방향 보정 <b data-v="directionAssist"></b> (1 = 항상 똑바로)</label>
        <input type="range" min="0" max="1" step="0.05" data-g="directionAssist" />
        <label>페이스 반영 계수 <b data-v="faceGain"></b></label>
        <input type="range" min="0" max="1.5" step="0.05" data-g="faceGain" />
        <label>경로 반영 계수 <b data-v="pathGain"></b></label>
        <input type="range" min="0" max="2" step="0.05" data-g="pathGain" />
        <label><input type="checkbox" data-k="invertFace" /> 페이스 방향 부호 반전 (실기기 보정용)</label>
        <label><input type="checkbox" data-k="invertPath" /> 경로 방향 부호 반전 (실기기 보정용)</label>
        <button data-act="reset">기본값으로</button>
      </div>
      <div class="card stack">
        <h3>정보</h3>
        <div class="muted">오른손 골퍼 기준 구질 명칭을 사용합니다. 페이스·경로 추정은 아직 실제 스윙으로 검증되지 않았습니다.</div>
      </div>
    </div></div>
  </section>`);

  function render() {
    el.querySelectorAll('[data-k]').forEach((i) => {
      if (i.dataset.k === 'swingDirectionFlip') i.checked = settings.swingDirection === -1;
      else if (i.type === 'checkbox') i.checked = !!settings[i.dataset.k];
      else i.value = String(settings[i.dataset.k]);
    });
    el.querySelectorAll('[data-g]').forEach((i) => {
      i.value = String(settings.game[i.dataset.g]);
    });
    el.querySelectorAll('[data-v]').forEach((b) => {
      b.textContent = settings.game[b.dataset.v];
    });
  }

  el.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.k) {
      const k = t.dataset.k;
      if (k === 'swingDirectionFlip') settings.swingDirection = t.checked ? -1 : 1;
      else settings[k] = t.type === 'checkbox' ? t.checked : k === 'sensorRateHz' || k === 'addressSeconds' ? Number(t.value) : t.value;
    } else if (t.dataset.g) {
      const g = t.dataset.g;
      settings.game[g] = t.type === 'range' ? Number(t.value) : t.value;
    }
    saveSettings();
    render();
  });
  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'back') app.show('home');
    if (act === 'reset') {
      Object.assign(settings.game, DEFAULT_SETTINGS.game);
      settings.invertFace = false;
      settings.invertPath = false;
      saveSettings();
      render();
    }
  });
  return { el, enter: render, leave() {} };
}

export function createSafetyScreen(app) {
  let next = null;
  const el = h(`
  <section class="screen" id="screen-safety">
    <div class="topbar"><button data-act="back">← 메뉴</button><span class="title">안전 안내</span></div>
    <div class="scroll-page"><div class="doc">
      <h2>스윙 전에 꼭 확인하세요</h2>
      <ul>
        <li><b>손목 스트랩</b>이 달린 케이스나 스트랩을 사용하고, 휴대폰을 양손으로 단단히 잡으세요.</li>
        <li><b>그립 방법</b>: 휴대폰 <b>화면이 클럽 페이스</b>입니다. 화면은 목표 쪽(오른손잡이는 몸 왼쪽)을 향하게 세우고, 휴대폰 끝(위쪽)은 공 쪽으로 비스듬히 아래를 향하게 그립처럼 쥡니다. 임팩트 때 화면이 목표를 향하면 스트레이트, 오른쪽으로 열리면 페이드·슬라이스, 왼쪽으로 닫히면 드로·훅 방향으로 계산합니다.</li>
        <li>주변 <b>2m 이상</b>에 사람, 반려동물, TV, 가구, 조명이 없는지 확인하세요.</li>
        <li><b>작고 느린 하프 스윙</b>으로 충분합니다. 이 게임은 전력 스윙을 요구하지 않으며, 세게 휘둘러도 거리가 늘지 않습니다 (파워 상한 적용).</li>
        <li>손목·팔꿈치·허리에 통증이 있으면 즉시 중단하세요.</li>
        <li>미끄러운 바닥, 좁은 실내, 천장이 낮은 곳에서는 사용하지 마세요.</li>
        <li><b>클럽별 어드레스</b>: 드라이버는 공을 왼발 뒤꿈치 쪽에 두고 샤프트를 거의 수직(0°)으로, 7번 아이언은 공을 가운데에 두고 손이 목표 쪽으로 약 4° 앞서게, 피칭 웨지는 공을 오른발 쪽에 두고 약 7° 앞서게 합니다 (휴대폰 끝이 그만큼 목표 반대쪽으로 기울어짐). 어드레스 화면에 현재 기울기와 권장 각도가 표시됩니다.</li>
        <li><b>임팩트</b>: 아이언·우드는 휴대폰이 어드레스 각도로 돌아온 순간, 드라이버는 최저점을 지나 살짝 올라오는 순간(약 4° 지난 지점)입니다.</li>
        <li>스윙 순서: <b>어드레스</b>(휴대폰 끝을 비스듬히 아래로, 3초 정지) → <b>백스윙</b>(휴대폰 뒷면 쪽, 즉 목표 반대쪽으로 들어 올림) → <b>탑</b>(잠깐 멈춤) → <b>다운스윙</b>(내려옴) → 임팩트. 화면 위쪽에 현재 인식된 단계가 표시됩니다.</li>
        <li>스윙 중에는 화면 터치가 잠깁니다. 잠금 해제는 오른쪽 위 버튼을 1초간 누르세요.</li>
        <li>센서 이상, 데이터 끊김, 충격(떨어뜨림 등)이 감지되면 공을 발사하지 않습니다.</li>
      </ul>
      <p class="warnbox">이 앱의 안내와 기능만으로 안전을 보장할 수 없습니다. 사용자는 주변 환경과 자신의 몸 상태를 직접 확인해야 합니다.</p>
      <div class="row" style="margin-top:14px">
        <button class="primary" data-act="accept">확인했습니다</button>
      </div>
    </div></div>
  </section>`);
  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'back') app.show('home');
    if (act === 'accept') {
      settings.safetyAccepted = true;
      saveSettings();
      app.show(next || 'home');
    }
  });
  return {
    el,
    enter(params = {}) {
      next = params.next ?? null;
    },
    leave() {},
  };
}

export function createTvScreen(app) {
  const el = h(`
  <section class="screen" id="screen-tv">
    <div class="topbar"><button data-act="back">← 메뉴</button><span class="title">TV 연결 안내</span></div>
    <div class="scroll-page"><div class="doc">
      <h2>LG 스마트 TV에 화면 미러링하기 (Smart View)</h2>
      <p>게임 계산과 그래픽은 모두 휴대폰에서 실행됩니다. TV는 휴대폰 화면을 보여 주기만 하므로 TV 연결 없이도 게임이 동작합니다.</p>
      <ol>
        <li>TV와 휴대폰을 <b>같은 Wi-Fi</b>에 연결합니다.</li>
        <li>LG TV 리모컨의 홈 버튼을 눌러 <b>Screen Share</b>(화면 공유) 앱을 실행합니다. 2020년 이전 webOS TV는 대부분 Miracast 방식의 Screen Share를 지원합니다. 모델에 따라 메뉴 이름이 다를 수 있습니다.</li>
        <li>갤럭시 휴대폰에서 화면 위쪽을 아래로 두 번 내려 <b>빠른 설정</b>을 열고 <b>Smart View</b>를 누릅니다.</li>
        <li>목록에서 TV 이름을 선택하고, TV 화면에 연결 요청이 나오면 허용합니다.</li>
        <li>이 앱은 <b>가로 화면(16:9)</b>으로 표시되므로 TV 화면을 가득 채웁니다.</li>
      </ol>
      <h2>팁</h2>
      <ul>
        <li>미러링에는 보통 0.1~0.3초 정도 지연이 있습니다. 스윙 분석은 휴대폰 센서로 하므로 지연이 판정에 영향을 주지 않습니다.</li>
        <li>스윙할 때는 TV를 등지거나 TV와 충분히 떨어진 위치에서 하세요.</li>
        <li>연결이 자주 끊기면 공유기와 TV 사이 거리를 줄이거나 5GHz Wi-Fi를 사용해 보세요.</li>
        <li>TV 모델명을 확인하면 정확한 메뉴 위치를 안내할 수 있습니다 (TV 설정 → 일반 → TV 정보).</li>
      </ul>
    </div></div>
  </section>`);
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-act]')?.dataset.act === 'back') app.show('home');
  });
  return { el, enter() {}, leave() {} };
}

