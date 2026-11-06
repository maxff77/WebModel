import { BaseProvider, type ChatRequest, type ModelInfo, type ProviderInfo } from './provider.js';
import type { StreamEvent } from './stream.js';

export interface PoolMember {
  /** Profile name: the account behind the provider. */
  name: string;
  provider: BaseProvider;
}

interface Member extends PoolMember {
  mutedUntil: number;
  coolUntil: number;
  coolWait: number;
  loggedOutUntil: number;
  /** Marked out of the turn; logged once when it serves again. */
  out: boolean;
  /** One call per account: its browser tab is the scarce resource. */
  busy: boolean;
  /** Chat attempts served, for the ban measurement. */
  recent: number[];
}

type ErrorEvent = Extract<StreamEvent, { type: 'error' }>;

/** What the pool turned down, for the server's refusal journal. */
export interface PoolRefusal {
  profile: string;
  code: string;
  /** Epoch ms when the sanction ends, when the provider reports one. */
  until?: number;
  at: string;
}

/** Notified around each attempt so the browser layer knows which account is in use. */
export interface PoolHooks {
  onAcquire?: (member: PoolMember) => void;
  onRelease?: (member: PoolMember) => void;
}

// The account turned the message down, so another account can take it without a duplicate.
// `challenge_required` belongs here: DeepSeek answered with a challenge instead of running
// the completion, so nothing was posted. The challenge flags the IP, not the account, so it
// does not bench the account (2026-11-05).
const REFUSALS = new Set(['account_muted', 'auth_expired', 'upstream_rate_limit', 'challenge_required']);

// Cooldown per account after "too frequent": doubles from 5 s up to 10 min, like the route's.
const FIRST_WAIT_MS = 5_000;
const CAP_MS = 600_000;
// 2026-11-06: the accounts that died served ~19 requests in 25 minutes (~45/h) and were
// challenged after ~2 minutes. Kept as a ban measurement, not as a cap (removed 2026-11-06).
const HOUR_MS = 3_600_000;
// A closed session costs ~10 s to find (page reload + bearer wait). Probed again after this,
// so a re-login typed into the account's own window is still picked up.
const LOGGED_OUT_RECHECK_MS = 300_000;

const log = (line: string) => console.log(`[pool] ${new Date().toISOString()} ${line}`);
const when = (t: number) => Number.isFinite(t) ? new Date(t).toISOString() : 'unknown';

/**
 * One provider's accounts in turn (A, B, A, B…), one call in flight per account, so
 * N accounts serve N calls at once; an extra call waits for the first free account.
 * A call an account refuses before answering moves on to the next account.
 */
export class ProviderPool extends BaseProvider {
  readonly info: ProviderInfo;
  private members: Member[];
  private cursor = 0;
  private freed: Array<() => void> = [];

  /** `here`: the provider on the active profile, whose login the dashboard shows. */
  constructor(
    members: PoolMember[],
    private readonly here?: BaseProvider,
    private readonly onRefusal?: (refusal: PoolRefusal) => void,
    private readonly hooks?: PoolHooks,
  ) {
    super();
    if (members.length === 0) throw new Error('A provider pool needs at least one account.');
    this.info = members[0].provider.info;
    this.members = members.map(m => ({ ...m, mutedUntil: 0, coolUntil: 0, coolWait: 0, loggedOutUntil: 0, out: false, busy: false, recent: [] }));
  }

  // ponytail: login only opens the provider's URL; the CLI runs it on the active profile.
  login(context: { openUrl: (url: string) => Promise<void> }): Promise<void> {
    return this.members[0].provider.login(context);
  }

  async isAuthenticated(): Promise<boolean> {
    for (const m of this.members) if (await m.provider.isAuthenticated()) return true;
    return false;
  }

  isLoggedInHere(): Promise<boolean> {
    return this.here ? this.here.isLoggedInHere() : this.isAuthenticated();
  }

  detectLoginComplete(): Promise<boolean> {
    return this.members[0].provider.detectLoginComplete();
  }

  models(): Promise<ModelInfo[]> {
    return this.members[0].provider.models();
  }

  async *chat(req: ChatRequest): AsyncIterable<StreamEvent> {
    const tried = new Set<Member>();
    let challengeRefusal: ErrorEvent | null = null;
    for (let member = await this.next(tried); member; member = await this.next(tried)) {
      tried.add(member);
      let refusal: ErrorEvent | null = null;
      try {
        if (req.signal?.aborted) return;
        this.record(member);
        log(`${this.info.id} → ${member.name}`);
        let produced = false;
        for await (const event of member.provider.chat(req)) {
          if (event.type === 'error' && !produced && REFUSALS.has(event.code ?? '')) { refusal = event; break; }
          if (event.type !== 'error' && event.type !== 'done') produced = true;
          yield event;
        }
      } finally {
        member.busy = false;
        this.hooks?.onRelease?.(member);
        this.freed.splice(0).forEach(wake => wake());
      }
      if (!refusal) { member.coolWait = 0; return; }
      if (refusal.code === 'challenge_required') challengeRefusal = refusal;
      this.markOut(member, refusal);
      this.onRefusal?.({
        profile: member.name,
        code: refusal.code ?? '',
        until: refusal.until,
        at: new Date().toISOString(),
      });
    }
    // A challenge is the actionable truth; "logged out" is only the by-elimination guess.
    yield challengeRefusal ?? this.allDown();
  }

  /** First account free from the cursor on, taken busy; the next call starts after it. All busy: waits. */
  private async next(tried: Set<Member>): Promise<Member | undefined> {
    for (;;) {
      const now = Date.now();
      // Read once: a concurrent call moves the cursor during the awaits below.
      const start = this.cursor;
      let busy = false;
      for (let i = 0; i < this.members.length; i++) {
        const index = (start + i) % this.members.length;
        const m = this.members[index];
        if (tried.has(m) || !(await this.free(m, now))) continue;
        // After the await: a concurrent call may have taken it meanwhile.
        if (m.busy) { busy = true; continue; }
        m.busy = true;
        this.cursor = index + 1;
        if (m.out) { m.out = false; log(`${m.name} back in turn`); }
        this.hooks?.onAcquire?.(m);
        return m;
      }
      if (!busy) return undefined;
      await new Promise<void>(wake => this.freed.push(wake));
    }
  }

  /**
   * The account the next call would take, without taking it, moving the cursor or
   * waiting for a busy one. Used to warm its browser ahead of its turn.
   */
  async peekNext(): Promise<PoolMember | undefined> {
    const now = Date.now();
    const start = this.cursor;
    for (let i = 0; i < this.members.length; i++) {
      const m = this.members[(start + i) % this.members.length];
      if (m.busy || !(await this.free(m, now))) continue;
      return m;
    }
    return undefined;
  }

  /** In turn and able to serve right now: authenticated, not cooling or muted. */
  private async free(m: Member, now: number): Promise<boolean> {
    if (m.mutedUntil > now || m.coolUntil > now) return false;
    // Logged out is the account's own auth state, so a dashboard login brings it back.
    if (!(await m.provider.isAuthenticated())) return false;
    // DeepSeek lets `expired` through isAuthenticated(); a dashboard login reads logged in here.
    if (m.loggedOutUntil > now && !(await m.provider.isLoggedInHere())) return false;
    return true;
  }

  private record(m: Member): void {
    const now = Date.now();
    m.recent.push(now);
    m.recent = m.recent.filter(t => t > now - HOUR_MS);
  }

  private markOut(m: Member, refusal: ErrorEvent): void {
    // A challenge flags the IP, not the account: it stays in the turn.
    if (refusal.code === 'challenge_required') return;
    m.out = true;
    if (refusal.code === 'account_muted') {
      // No end date: out until restart.
      m.mutedUntil = refusal.until ?? Infinity;
      log(`${m.name} out: muted until ${when(m.mutedUntil)}`);
    } else if (refusal.code === 'upstream_rate_limit') {
      m.coolWait = m.coolWait ? Math.min(m.coolWait * 2, CAP_MS) : FIRST_WAIT_MS;
      m.coolUntil = Date.now() + m.coolWait;
      log(`${m.name} out: too frequent, cooling ${m.coolWait / 1000}s`);
    } else {
      const now = Date.now();
      const inHour = m.recent.filter(t => t > now - HOUR_MS).length;
      const inTen = m.recent.filter(t => t > now - 600_000).length;
      m.loggedOutUntil = now + LOGGED_OUT_RECHECK_MS;
      log(`${m.name} out: logged out after ${inHour} req/1h (${inTen}/10m), next check in ${LOGGED_OUT_RECHECK_MS / 1000}s`);
    }
  }

  /** Every account is out. A cooling window clears at a known time. */
  private allDown(): ErrorEvent {
    const now = Date.now();
    const name = this.info.name;
    const cooling = this.members.filter(m => m.coolUntil > now);
    if (cooling.length > 0) {
      const wait = Math.ceil((Math.min(...cooling.map(m => m.coolUntil)) - now) / 1000);
      return { type: 'error', code: 'upstream_rate_limit', message: `${name}: every account is rate limited; the first frees up in ${wait}s` };
    }
    const muted = this.members.filter(m => m.mutedUntil > now);
    if (muted.length < this.members.length) {
      // Neither cooling nor muted: by elimination, logged out.
      const names = this.members.filter(m => !muted.includes(m)).map(m => m.name).join(', ');
      return { type: 'error', code: 'auth_expired', message: `${name}: no account can serve; log in again: ${names}` };
    }
    const until = Math.min(...muted.map(m => m.mutedUntil));
    return { type: 'error', code: 'account_muted', until, message: `${name}: every account is muted; the first is free at ${when(until)}` };
  }
}
