// Second-order Butterworth low-pass (RBJ biquad) and zero-phase filtfilt.

export function butterLowpass(cutoffHz, fs) {
  const w0 = (2 * Math.PI * Math.min(cutoffHz, fs * 0.45)) / fs;
  const q = Math.SQRT1_2;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  return {
    b: [(1 - cos) / 2 / a0, (1 - cos) / a0, (1 - cos) / 2 / a0],
    a: [1, (-2 * cos) / a0, (1 - alpha) / a0],
  };
}

function biquad(x, { b, a }) {
  const y = new Float64Array(x.length);
  if (x.length === 0) return y;
  // Initialise state at steady state for the first sample to avoid a start-up transient.
  let x1 = x[0], x2 = x[0], y1 = x[0], y2 = x[0];
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = b[0] * xi + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    y[i] = yi;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi;
  }
  return y;
}

/** Zero-phase forward-backward filter. */
export function filtfilt(x, coeffs) {
  const fwd = biquad(x, coeffs);
  fwd.reverse();
  const back = biquad(fwd, coeffs);
  back.reverse();
  return back;
}
