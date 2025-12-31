// src/runner/TerminalStoryRunner.ts
/* ============================================================================
 * TerminalStoryRunner.ts (TypeScript) — framework-agnostic
 * - Async print support (typewriter)
 * - Per-line print options: { instant?: boolean }
 * - sequence lines can include: { text, delayMs, instant? }
 * ========================================================================== */

export type Machine = {
  id: string;
  version: string;
  context: { vars: Record<string, string> };
  start: string;
  states: State[];
};

export type State = SequenceState | InputState | ChoiceState;

export type SequenceLine = {
  text: string;
  delayMs: number;
  instant?: boolean;
  speed?: "normal" | "fast";
};

export type SequenceState = {
  id: string;
  type: "sequence";
  lines: SequenceLine[];
  to?: string;
  await?: { event: "enter" };
  on?: Array<{ event: "enter"; to: string }>;
  actions?: Action[];
  terminal?: boolean;
};

export type InputState = {
  id: string;
  type: "input";
  input: {
    id: string;
    label: string;
    placeholder?: string;
    minLength?: number;
    maxLength?: number;
    trim?: boolean;
  };
  on: Array<Transition>;
};

export type ChoiceState = {
  id: string;
  type: "choice";
  prompt: string;
  choices: Array<{
    id: string;
    label: string;
    actions?: Action[];
    to: string;
  }>;
};

export type Transition = {
  event: "submit";
  guards?: Guard[];
  actions?: Action[];
  to: string;
};

export type Guard = { type: "minLength"; field: "value"; value: number };

export type Action = {
  type: "setVar";
  key: string;
  value?: string;
  valueFrom?: "value";
};

export type RunnerMode =
  | "idle"
  | "running"
  | "waiting_input"
  | "waiting_choice"
  | "waiting_enter"
  | "terminated";

export type PrintOptions = { instant?: boolean; speed?: "normal" | "fast" };

export type OutputAdapter = {
  /**
   * Called when runner prints a line to the terminal output.
   * Can be async (e.g., typewriter). Runner will await it.
   * opts.instant means: print without typewriter (UI decides behavior).
   */
  print: (text: string, opts?: PrintOptions) => void | Promise<void>;

  showInput: (spec: InputState["input"]) => void | Promise<void>;
  showChoices: (
    prompt: string,
    choices: ChoiceState["choices"]
  ) => void | Promise<void>;
  clearInteractive: () => void;

  onStateChange?: (stateId: string, mode: RunnerMode) => void;
  onValidationError?: (message: string) => void;
};

type Pending =
  | { kind: "none" }
  | { kind: "input"; stateId: string }
  | { kind: "choice"; stateId: string }
  | { kind: "enter"; stateId: string };

export class TerminalStoryRunner {
  private machine: Machine;
  private output: OutputAdapter;

  private stateIndex: Map<string, State> = new Map();
  private _mode: RunnerMode = "idle";
  private _currentStateId: string | null = null;

  private pending: Pending = { kind: "none" };
  private cancelledToken = 0;

  public readonly vars: Record<string, string>;

  constructor(machine: Machine, output: OutputAdapter) {
    this.machine = machine;
    this.output = output;

    for (const st of machine.states) this.stateIndex.set(st.id, st);
    if (!this.stateIndex.has(machine.start)) {
      throw new Error(`Machine start state not found: ${machine.start}`);
    }

    this.vars = { ...(machine.context?.vars || {}) };
  }

  get mode(): RunnerMode {
    return this._mode;
  }

  get currentStateId(): string | null {
    return this._currentStateId;
  }

  public start(): void {
    this.cancelledToken++;
    this.pending = { kind: "none" };
    this.output.clearInteractive();
    this.transitionTo(this.machine.start);
  }

  public stop(): void {
    this.cancelledToken++;
    this.pending = { kind: "none" };
    this._mode = "terminated";
    this.emitState();
  }

  public async submit(value: string): Promise<void> {
    if (this.pending.kind !== "input") return;

    const state = this.getState<InputState>(this.pending.stateId, "input");

    let v = value ?? "";
    if (state.input.trim) v = v.trim();
    if (typeof state.input.maxLength === "number")
      v = v.slice(0, state.input.maxLength);

    const t = state.on.find((x) => x.event === "submit");
    if (!t) return;

    const guardError = this.evaluateGuards(t.guards, v);
    if (guardError) {
      this.output.onValidationError?.(guardError);
      return;
    }

    this.applyActions(t.actions, v);

    this.pending = { kind: "none" };
    this.output.clearInteractive();
    await this.transitionTo(t.to);
  }

  public async choose(choiceId: string): Promise<void> {
    if (this.pending.kind !== "choice") return;

    const state = this.getState<ChoiceState>(this.pending.stateId, "choice");
    const choice = state.choices.find((c) => c.id === choiceId);
    if (!choice) return;

    this.applyActions(choice.actions, undefined);

    this.pending = { kind: "none" };
    this.output.clearInteractive();
    await this.transitionTo(choice.to);
  }

  public async enter(): Promise<void> {
    if (this.pending.kind !== "enter") return;

    const state = this.getState<SequenceState>(
      this.pending.stateId,
      "sequence"
    );
    const next = state.on?.find((x) => x.event === "enter")?.to;

    this.pending = { kind: "none" };
    if (next) await this.transitionTo(next);
  }

  /* -------------------------- Internals -------------------------- */

  private async transitionTo(stateId: string): Promise<void> {
    const st = this.stateIndex.get(stateId);
    if (!st) throw new Error(`Unknown state: ${stateId}`);

    this._currentStateId = stateId;

    if ((st as any).terminal) {
      this._mode = "terminated";
      this.emitState();
      return;
    }

    switch (st.type) {
      case "sequence":
        void this.runSequence(st);
        return;

      case "input":
        this._mode = "waiting_input";
        this.pending = { kind: "input", stateId: st.id };
        this.emitState();
        await this.output.showInput(st.input);
        return;

      case "choice": {
        this._mode = "waiting_choice";
        this.pending = { kind: "choice", stateId: st.id };
        this.emitState();

        const prompt = st.prompt ? this.interpolate(st.prompt) : "";
        await this.output.showChoices(prompt, st.choices);
        return;
      }

      default: {
        const _exhaustive: never = st;
        void _exhaustive; // Marca como usado para TypeScript
        throw new Error(`Unsupported state type: ${(st as any).type}`);
      }
    }
  }

  private async runSequence(state: SequenceState): Promise<void> {
    const token = ++this.cancelledToken;
    this._mode = "running";
    this.emitState();

    this.applyActions(state.actions, undefined);

    for (let idx = 0; idx < state.lines.length; idx++) {
      const line = state.lines[idx];
      if (!line || this.cancelledToken !== token) return;

      const text = this.interpolate(line.text);

      await this.output.print(text, {
        instant: !!line.instant,
        speed: line.speed ?? "normal",
      });

      if (line.delayMs && line.delayMs > 0)
        await this.sleep(line.delayMs, token);
    }

    if (this.cancelledToken !== token) return;

    if (state.await?.event === "enter") {
      this._mode = "waiting_enter";
      this.pending = { kind: "enter", stateId: state.id };
      this.emitState();
      return;
    }

    if (state.to) {
      await this.transitionTo(state.to);
      return;
    }

    this._mode = "terminated";
    this.emitState();
  }

  private sleep(ms: number, token: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(() => {
        if (this.cancelledToken !== token) return resolve();
        resolve();
      }, ms);
    });
  }

  private interpolate(text: string): string {
    return (text ?? "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
      const v = this.vars[key];
      return (v ?? "").toString();
    });
  }

  private applyActions(
    actions: Action[] | undefined,
    submittedValue: string | undefined
  ): void {
    if (!actions?.length) return;

    for (const a of actions) {
      if (a.type === "setVar") {
        let v = "";
        if (a.valueFrom === "value") v = submittedValue ?? "";
        else if (typeof a.value === "string") v = a.value;
        this.vars[a.key] = v;
      }
    }
  }

  private evaluateGuards(
    guards: Guard[] | undefined,
    value: string
  ): string | null {
    if (!guards?.length) return null;

    for (const g of guards) {
      if (g.type === "minLength") {
        if ((value ?? "").length < g.value) {
          return `Introduce al menos ${g.value} carácter(es).`;
        }
      }
    }
    return null;
  }

  private getState<T extends State>(stateId: string, type: T["type"]): T {
    const st = this.stateIndex.get(stateId);
    if (!st) throw new Error(`Unknown state: ${stateId}`);
    if (st.type !== type)
      throw new Error(`State ${stateId} is not type ${type}`);
    return st as T;
  }

  private emitState(): void {
    this.output.onStateChange?.(this._currentStateId ?? "?", this._mode);
  }
}

/* ============================================================================
 * Optional: Console adapter for quick smoke testing
 * ========================================================================== */
export class ConsoleAdapter implements OutputAdapter {
  print(text: string): void {
    // eslint-disable-next-line no-console
    console.log(text);
  }
  showInput(spec: InputState["input"]): void {
    // eslint-disable-next-line no-console
    console.log(`[INPUT] ${spec.label}`);
  }
  showChoices(prompt: string, choices: ChoiceState["choices"]): void {
    // eslint-disable-next-line no-console
    if (prompt) console.log(prompt);
    // eslint-disable-next-line no-console
    console.log("[CHOICES]", choices.map((c) => c.label).join(" | "));
  }
  clearInteractive(): void {}
  onValidationError(message: string): void {
    // eslint-disable-next-line no-console
    console.log(`[VALIDATION] ${message}`);
  }
}
