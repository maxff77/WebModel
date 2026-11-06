import type { Page } from 'playwright-core';

/**
 * hCaptcha sitekey hardcoded in chat.deepseek.com's main bundle (read 2026-11-03).
 * The web client renders an invisible widget with it and replays the request.
 */
export const DEEPSEEK_HCAPTCHA_SITEKEY = '352e5376-f2cc-43fe-a744-e51640449610';

/** Header the web client adds on the replayed request. */
export const CHALLENGE_RESPONSE_HEADER = 'x-ds-challenge-response';

export interface HcaptchaChallenge {
  challengeId: string;
  rqdata?: string;
}

/**
 * The completion answers HTTP 200 with {code:40303,msg:"CHALLENGE_REQUIRED",
 * data:{provider:"hcaptcha",challenge_id,extras:{rqdata}}} when DeepSeek wants a
 * captcha. Returns the challenge to solve, or null for any other body.
 */
export function hcaptchaChallenge(body: string): HcaptchaChallenge | null {
  if (!body.includes('CHALLENGE_REQUIRED')) return null;
  try {
    const parsed = JSON.parse(body);
    const data = parsed?.data;
    if (parsed?.code !== 40303 || data?.provider !== 'hcaptcha') return null;
    if (typeof data.challenge_id !== 'string' || !data.challenge_id) return null;
    const rqdata = data.extras?.rqdata;
    return { challengeId: data.challenge_id, rqdata: typeof rqdata === 'string' ? rqdata : undefined };
  } catch {
    return null;
  }
}

/**
 * Under Patchright (the Apostate driver) page.evaluate runs in an isolated world
 * whose customElements is null, so hCaptcha's API never initializes there. A
 * script element executes in the page's main world, and the DOM is the only
 * channel both worlds share: the main world writes its result into a div, this
 * side polls it.
 *
 * Returns the base64 x-ds-challenge-response value, or null when no token came.
 */
export async function solveHcaptcha(
  page: Page,
  challenge: HcaptchaChallenge,
  timeoutMs = 90_000,
): Promise<string | null> {
  const outId = `wmb-challenge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const options = JSON.stringify({ sitekey: DEEPSEEK_HCAPTCHA_SITEKEY, rqdata: challenge.rqdata ?? null });

  // hCaptcha distrusts a hidden tab, and an interactive challenge has to be
  // visible for the user to click it in the bridge window.
  await page.bringToFront().catch(() => {});

  try {
    await page.addScriptTag({ content: mainWorldScript(outId, options) });
  } catch (err) {
    console.warn(`[deepseek-web] hCaptcha script injection failed: ${(err as Error).message}`);
    return null;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const raw = await page
      .evaluate((id: string) => document.getElementById(id)?.textContent ?? null, outId)
      .catch(() => null);
    if (raw) {
      let result: { token?: string | null; error?: string };
      try { result = JSON.parse(raw); } catch { result = {}; }
      if (result.error) {
        console.warn(`[deepseek-web] hCaptcha challenge failed: ${result.error}`);
        return null;
      }
      if (result.token) {
        return Buffer.from(JSON.stringify({
          provider: 'hcaptcha',
          challenge_id: challenge.challengeId,
          hcaptcha_token: result.token,
        })).toString('base64');
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.warn(`[deepseek-web] hCaptcha challenge timed out after ${timeoutMs}ms`);
  return null;
}

/**
 * Runs in the page's main world. Kept as a string: the page world cannot see
 * anything this side defines, and esbuild helpers do not exist there.
 */
export function mainWorldScript(outId: string, options: string): string {
  return `(() => {
  const out = document.createElement('div');
  out.id = ${JSON.stringify(outId)};
  out.style.display = 'none';
  document.body.appendChild(out);
  const done = (v) => { out.textContent = JSON.stringify(v); };
  const config = ${options};
  // hCaptcha's render() whitelist drops rqdata; the web client attaches it
  // with setData() after rendering, then executes the invisible widget.
  const opts = { sitekey: config.sitekey, size: 'invisible', tplinks: 'on' };
  const run = () => {
    try {
      const div = document.createElement('div');
      document.body.appendChild(div);
      opts['error-callback'] = (e) => done({ error: 'hCaptcha: ' + JSON.stringify(e) });
      const widget = window.hcaptcha.render(div, opts);
      if (config.rqdata) {
        if (typeof window.hcaptcha.setData !== 'function') {
          done({ error: 'hCaptcha setData unavailable' });
          return;
        }
        window.hcaptcha.setData(widget, { rqdata: config.rqdata });
      }
      window.hcaptcha.execute(widget, { async: true }).then(
        (r) => done({ token: (r && r.response) || null }),
        (e) => done({ error: String((e && e.message) || e) }),
      );
    } catch (e) { done({ error: String((e && e.message) || e) }); }
  };
  if (window.hcaptcha && window.hcaptcha.render) return run();
  window.__wmbHcaptchaWaiting = window.__wmbHcaptchaWaiting || [];
  window.__wmbHcaptchaWaiting.push(run);
  if (window.__wmbHcaptchaLoading) return;
  window.__wmbHcaptchaLoading = true;
  window.__wmbHcaptchaOnload = () => { for (const fn of window.__wmbHcaptchaWaiting.splice(0)) fn(); };
  const s = document.createElement('script');
  s.src = 'https://js.hcaptcha.com/1/api.js?render=explicit&onload=__wmbHcaptchaOnload';
  s.onerror = () => done({ error: 'hCaptcha API script failed to load' });
  document.head.appendChild(s);
})();`;
}
