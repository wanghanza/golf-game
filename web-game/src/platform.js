// Bridge to the Android host (android-app MainActivity) with browser fallbacks.

const native = () => (typeof window !== 'undefined' ? window.GolfNative : undefined);

export const isAndroidApp = () => !!native();

function callJson(fn, fallback) {
  try {
    const r = native()?.[fn]?.();
    return r ? JSON.parse(r) : fallback;
  } catch (e) {
    return fallback;
  }
}

export function deviceInfo() {
  return callJson('getDeviceInfo', { model: navigator.userAgent, platform: 'browser' });
}

export function nativeSensorInfo() {
  return callJson('getSensorInfo', null);
}

export function vibrate(ms = 40) {
  try {
    if (native()) native().vibrate(ms);
    else navigator.vibrate?.(ms);
  } catch (e) {
    /* ignore */
  }
}

export function keepScreenOn(on) {
  try {
    native()?.setKeepScreenOn(!!on);
  } catch (e) {
    /* ignore */
  }
}

/**
 * Save text files. On Android they go to Downloads/GolfSwingReader (and the
 * share sheet can be opened); in a browser they are downloaded.
 * @param {{name: string, mime: string, content: string}[]} files
 * @returns {Promise<string>} human readable location
 */
export async function saveFiles(files, { share = false } = {}) {
  const n = native();
  if (n) {
    const paths = [];
    for (const f of files) {
      const r = n.saveTextFile(f.name, f.mime, f.content);
      if (!r || r.startsWith('ERROR')) throw new Error(r || 'save failed');
      paths.push(r);
    }
    if (share) n.shareFiles(JSON.stringify(files.map((f) => f.name)));
    return paths.join('\n');
  }
  for (const f of files) {
    const blob = new Blob([f.content], { type: f.mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }
  return '브라우저 다운로드 폴더';
}
