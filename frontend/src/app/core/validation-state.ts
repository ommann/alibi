import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { VALIDATION_RPC } from './rpc-client';
import type { Plan, Snapshot } from '../../../../shared/contracts';

@Injectable({ providedIn: 'root' })
export class ValidationState {
  private readonly rpc = inject(VALIDATION_RPC);
  private readonly selectedProject = signal<string | null>(null);
  private readonly snapshot = signal<Snapshot | null>(null);
  private readonly connectionError = signal<string | null>(null);
  private readonly connectionStatus = signal<'idle' | 'connecting' | 'connected' | 'reconnecting'>('idle');
  private controller?: AbortController;

  readonly pending = signal(false);
  readonly actionError = signal<string | null>(null);
  readonly editingDisabled = computed(() => !this.snapshot() || this.snapshot()!.busy || this.pending());

  readonly cwd = this.selectedProject.asReadonly();
  readonly state = this.snapshot.asReadonly();
  readonly error = this.connectionError.asReadonly();
  readonly status = this.connectionStatus.asReadonly();
  readonly latestRun = computed(() => this.snapshot()?.runs.at(-1) ?? null);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.controller?.abort());
  }

  selectProject(cwd: string | null): void {
    const selected = cwd?.trim() || null;
    if (selected === this.selectedProject()) return;
    this.controller?.abort();
    this.selectedProject.set(selected);
    this.snapshot.set(null);
    this.connectionError.set(null);
    this.connectionStatus.set(selected ? 'connecting' : 'idle');
    if (selected) {
      this.controller = new AbortController();
      void this.watch(selected, this.controller.signal);
    }
  }

  async configure(plan: Plan): Promise<void> {
    if (this.editingDisabled()) return;
    await this.action(cwd => this.rpc.configure({ cwd, plan }));
  }

  async run(): Promise<void> {
    if (this.editingDisabled()) return;
    await this.action(cwd => this.rpc.run({ cwd }));
  }

  async stop(): Promise<void> {
    if (this.pending()) return;
    await this.action(cwd => this.rpc.stop({ cwd }));
  }

  private async action(operation: (cwd: string) => Promise<unknown>): Promise<void> {
    const cwd = this.cwd();
    if (!cwd) return;

    this.pending.set(true);
    this.actionError.set(null);

    try {
      await operation(cwd);
    } catch (error) {
      if (this.cwd() === cwd) this.actionError.set(String(error));
    } finally {
      this.pending.set(false);
    }
  }

  private async watch(cwd: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const stream = await this.rpc.watch({ cwd }, { signal });
        for await (const state of stream) {
          if (signal.aborted) return;
          this.snapshot.set(state);
          this.connectionError.set(null);
          this.connectionStatus.set('connected');
        }
        if (!signal.aborted) this.connectionError.set('Connection closed. Reconnecting…');
      } catch (error) {
        if (signal.aborted) return;
        this.connectionError.set(error instanceof Error ? error.message : String(error));
      }
      if (signal.aborted) return;
      this.connectionStatus.set('reconnecting');
      await this.retryDelay(signal);
    }
  }

  private retryDelay(signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, 1500);
      signal.addEventListener('abort', done, { once: true });
      if (signal.aborted) done();
    });
  }
}
