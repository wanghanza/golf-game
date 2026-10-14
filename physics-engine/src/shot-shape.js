// Shot shape naming for a right-handed golfer, from start direction and
// spin-axis tilt (ball-flight laws / D-plane).
//
//   start direction: + right of target, - left
//   spin axis:       + curves right (fade/slice), - curves left (draw/hook)

export const SHOT_SHAPES = Object.freeze({
  straight: '스트레이트',
  draw: '드로',
  fade: '페이드',
  hook: '훅',
  slice: '슬라이스',
  push: '푸시',
  pull: '풀',
  pushSlice: '푸시 슬라이스',
  pullHook: '풀 훅',
  pushDraw: '푸시 드로',
  pullFade: '풀 페이드',
});

export function classifyShot(startDirectionDeg, spinAxisDeg, opts = {}) {
  const startTol = opts.startTolDeg ?? 2;
  const curveTol = opts.curveTolDeg ?? 3;
  const strongCurve = opts.strongCurveDeg ?? 15;
  const start = startDirectionDeg > startTol ? 'right' : startDirectionDeg < -startTol ? 'left' : 'center';
  const curve =
    spinAxisDeg > strongCurve ? 'R2' : spinAxisDeg > curveTol ? 'R1' :
      spinAxisDeg < -strongCurve ? 'L2' : spinAxisDeg < -curveTol ? 'L1' : '0';

  let key;
  if (start === 'center') {
    key = { '0': 'straight', R1: 'fade', R2: 'slice', L1: 'draw', L2: 'hook' }[curve];
  } else if (start === 'right') {
    key = { '0': 'push', R1: 'pushSlice', R2: 'pushSlice', L1: 'pushDraw', L2: 'hook' }[curve];
  } else {
    key = { '0': 'pull', R1: 'pullFade', R2: 'slice', L1: 'pullHook', L2: 'pullHook' }[curve];
  }
  return { key, label: SHOT_SHAPES[key] };
}
