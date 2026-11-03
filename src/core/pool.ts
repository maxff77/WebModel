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

// The account turned the message down, so another account can take it without a duplicate.
const REFUSALS = new Set(['account_muted', 'auth_expired', 'upstream_rate_limit']);

// Cooldown per account after "too frequent": doubles from 5 s up to 10 min, like the route's.
const FIRST_WAIT_MS = 5_000;
const CAP_MS = 600_000;
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
  ) {
    super();
    if (members.length === 0) throw new Error('A provider pool needs at least one account.');
    this.info = members[0].provider.info;
    this.members = members.map(m => ({ ...m, mutedUntil: 0, coolUntil: 0, coolWait: 0, loggedOutUntil: 0, out: false, busy: false }));
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
    for (let member = await this.next(tried); member; member = await this.next(tried)) {
      tried.add(member);
      let refusal: ErrorEvent | null = null;
      try {
        if (req.signal?.aborted) return;
        log(`${this.info.id} → ${member.name}`);
        let produced = false;
        for await (const event of member.provider.chat(req)) {
          if (event.type === 'error' && !produced && REFUSALS.has(event.code ?? '')) { refusal = event; break; }
          if (event.type !== 'error' && event.type !== 'done') produced = true;
          yield event;
        }
      } finally {
        member.busy = false;
        this.freed.splice(0).forEach(wake => wake());
      }
      if (!refusal) { member.coolWait = 0; return; }
      this.markOut(member, refusal);
      this.onRefusal?.({
        profile: member.name,
        code: refusal.code ?? '',
        until: refusal.until,
        at: new Date().toISOString(),
      });
    }
    yield this.allDown();
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
        if (tried.has(m) || m.mutedUntil > now || m.coolUntil > now) continue;
        // Logged out is the account's own auth state, so a dashboard login brings it back.
        if (!(await m.provider.isAuthenticated())) continue;
        // DeepSeek lets `expired` through isAuthenticated(); a dashboard login reads logged in here.
        if (m.loggedOutUntil > now && !(await m.provider.isLoggedInHere())) continue;
        // After the await: a concurrent call may have taken it meanwhile.
        if (m.busy) { busy = true; continue; }
        m.busy = true;
        this.cursor = index + 1;
        if (m.out) { m.out = false; log(`${m.name} back in turn`); }
        return m;
      }
      if (!busy) return undefined;
      await new Promise<void>(wake => this.freed.push(wake));
    }
  }

  private markOut(m: Member, refusal: ErrorEvent): void {
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
      m.loggedOutUntil = Date.now() + LOGGED_OUT_RECHECK_MS;
      log(`${m.name} out: logged out, next check in ${LOGGED_OUT_RECHECK_MS / 1000}s`);
    }
  }

  /** Every account is out. Cooling wins (it clears soonest), then logged out, then muted. */
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
