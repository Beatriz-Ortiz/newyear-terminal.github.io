<!-- src/ui/components/TerminalView.vue -->
<script setup lang="ts">
import {
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  computed,
  nextTick,
} from "vue";
import machine from "../../story/machine.json";
import {
  TerminalStoryRunner,
  type InputState,
  type ChoiceState,
  type OutputAdapter,
  type Machine,
} from "../../runner/TerminalStoryRunner";

// stable id for output items to avoid index-based keys
let nextOutputId = 0;

type OutputItemWithId =
  | { id: number; kind: "line"; text: string; active?: boolean }
  | { id: number; kind: "blank" };

const PROMPT = "system@newyear:~$";

const outputItems = reactive<OutputItemWithId[]>([]);
const scrollRef = ref<HTMLDivElement | null>(null);

const ui = reactive({
  inputSpec: null as InputState["input"] | null,
  inputValue: "",
  choicesPrompt: "",
  choices: [] as ChoiceState["choices"],
  waitingEnter: false,
  terminated: false,
});

const typing = reactive({
  isTyping: false,
  skipRequested: false,
});

const minimized = ref(false);
const popped = ref(false);

function controlClose() {
  if (typing.isTyping) typing.skipRequested = true;
  void enqueuePrint(() => typeLine("Cerrando sesión (simulado)... 🚪"));
  // stop runner after a brief delay so message prints
  setTimeout(() => {
    try {
      runner.stop();
      ui.terminated = true;
    } catch (e) {
      /* ignore */
    }
  }, 500);
}

function controlMinimize() {
  minimized.value = !minimized.value;
  void enqueuePrint(() =>
    typeLine(minimized.value ? "Minimizado 🗕" : "Restaurado 🗖")
  );
}

function controlMaximize() {
  popped.value = !popped.value;
  void enqueuePrint(() =>
    typeLine(popped.value ? "Maximizado 🖥️" : "Restaurado tamaño 🪟")
  );
}

// Serializes prints so they never overlap
let printQueue: Promise<void> = Promise.resolve();

// ---------------- Utils ----------------
function nextFrame() {
  return new Promise<number>((r) => requestAnimationFrame(r));
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

let lastScrollAt = 0;
async function autoScrollThrottled() {
  const now = performance.now();
  if (now - lastScrollAt < 110) return;
  lastScrollAt = now;

  await nextTick();
  const el = scrollRef.value;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

function enqueuePrint(fn: () => Promise<void>) {
  printQueue = printQueue.then(fn).catch(() => {});
  return printQueue;
}

// ---------------- Typewriter ----------------
async function typeLine(text: string) {
  if (!text) {
    outputItems.push({ id: ++nextOutputId, kind: "blank" });
    await autoScrollThrottled();
    return;
  }

  const item: OutputItemWithId = {
    id: ++nextOutputId,
    kind: "line",
    text: "",
    active: true,
  };
  outputItems.push(item);

  typing.isTyping = true;
  typing.skipRequested = false;

  const cps = text.length > 140 ? 18 : 12; // slower overall
  const punctuationPause: Record<string, number | undefined> = {
    ".": 160,
    ",": 110,
    "!": 160,
    "?": 160,
    ":": 140,
    ";": 130,
  };

  let i = 0;
  let budget = 0;
  let last = performance.now();

  while (i < text.length) {
    if (typing.skipRequested) {
      (item as any).text = text;
      break;
    }

    const t = await nextFrame();
    const dt = Math.max(0, (t - last) / 1000);
    last = t;

    budget += dt * cps;
    if (budget < 1) continue;
    budget -= 1;

    const ch = text[i++];
    (item as any).text += ch;

    void autoScrollThrottled();

    const pause = (ch ? punctuationPause[ch] : undefined) ?? 0;
    if (pause && i < text.length) await sleep(pause);
  }

  (item as any).active = false;
  typing.isTyping = false;
  typing.skipRequested = false;

  await autoScrollThrottled();
}

// ---------------- Runner Adapter ----------------
const adapter: OutputAdapter = {
  // Wait for typing to complete before runner continues
  print: async (text: string) => {
    await enqueuePrint(() => typeLine(text));
  },

  showInput: async (spec) => {
    // If typing is in progress, request it to finish immediately
    if (typing.isTyping) typing.skipRequested = true;

    // Wait for any pending prints to finish so input appears after text
    await printQueue;

    // finalize any active typing item so prompt appears
    for (const it of outputItems) {
      if ((it as any).kind === "line" && (it as any).active) {
        (it as any).active = false;
      }
    }

    // wait for DOM render and enter animation to finish
    await nextTick();
    await sleep(320);
    await autoScrollThrottled();

    ui.inputSpec = spec;
    ui.inputValue = "";
    ui.choices = [];
    ui.choicesPrompt = "";
    ui.waitingEnter = false;

    await nextTick();
    void autoScrollThrottled();
    (
      document.getElementById("terminal-input") as HTMLInputElement | null
    )?.focus();
  },

  showChoices: async (prompt, choices) => {
    // If typing is in progress, request it to finish immediately
    if (typing.isTyping) typing.skipRequested = true;

    // Wait for any pending prints to complete first - capture the current queue
    const currentQueue = printQueue;
    await currentQueue;

    // CRITICAL: Immediately finalize all active items
    for (const it of outputItems) {
      if ((it as any).kind === "line" && (it as any).active) {
        (it as any).active = false;
      }
    }

    // Add a blank line to force the last line to fully render
    // This prevents the transition-group from holding the last line in animation queue
    outputItems.push({ id: ++nextOutputId, kind: "blank" });

    // Wait for Vue to process the active: false change and animations
    // The line-enter-active animation takes 260ms PER LINE
    // We need to wait for the LAST line's animation to complete
    await nextTick();
    await sleep(100);
    await nextTick();

    // Wait for the last line's enter animation (260ms + extra margin)
    await sleep(400);
    await nextTick();

    // Force scroll to ensure all content is visible
    await autoScrollThrottled();

    // Now set the choices - all lines should be visible
    ui.choicesPrompt = prompt ?? "";
    ui.choices = choices ?? [];
    ui.inputSpec = null;
    ui.waitingEnter = false;

    // Wait for Vue to render the choices which will expand the footer
    await nextTick();
    await nextTick();
    await sleep(100);

    // Now scroll to ensure the last line is still visible after footer expansion
    await autoScrollThrottled();
  },

  clearInteractive: () => {
    ui.inputSpec = null;
    ui.choices = [];
    ui.inputValue = "";
    ui.choicesPrompt = "";
  },

  onStateChange: (_stateId, mode) => {
    ui.waitingEnter = mode === "waiting_enter";
    ui.terminated = mode === "terminated";
  },

  onValidationError: (message) => {
    void enqueuePrint(() => typeLine(message));
  },
};

const runner = new TerminalStoryRunner(machine as unknown as Machine, adapter);

// ---------------- UI logic ----------------
const hasChoices = computed(() => ui.choices.length > 0 && !ui.terminated);

function printUserCommand(cmd: string) {
  outputItems.push({
    id: ++nextOutputId,
    kind: "line",
    text: `${PROMPT} ${cmd}`,
    active: false,
  });
  void autoScrollThrottled();
}

// Función no utilizada actualmente, comentada para evitar warnings
// function handleEnter() {
//   if (ui.terminated) return;

//   // Si se está tipando, completar la línea
//   if (typing.isTyping) {
//     typing.skipRequested = true;
//     return;
//   }

//   // Si hay input, enviar el valor
//   if (hasInput.value) {
//     printUserCommand(ui.inputValue);
//     runner.submit(ui.inputValue);
//     ui.inputValue = "";
//     return;
//   }

//   // Si espera ENTER, enviar ENTER
//   if (ui.waitingEnter) {
//     printUserCommand("");
//     runner.enter();
//     return;
//   }

//   // Si hay choices, ignorar (usar click en botón)
//   if (hasChoices.value) {
//     return;
//   }
// }

function choose(id: string) {
  if (ui.terminated) return;
  const c = ui.choices.find((x) => x.id === id);
  if (!c) return;

  if (typing.isTyping) typing.skipRequested = true;

  printUserCommand(c.label);
  runner.choose(id);
}

function restart() {
  outputItems.splice(0);
  ui.inputSpec = null;
  ui.inputValue = "";
  ui.choicesPrompt = "";
  ui.choices = [];
  ui.waitingEnter = false;
  ui.terminated = false;

  typing.isTyping = false;
  typing.skipRequested = false;

  printQueue = Promise.resolve();

  runner.start();
  nextTick(() =>
    (
      document.getElementById("terminal-input") as HTMLInputElement | null
    )?.focus()
  );
}

onMounted(() => {
  runner.start();
});
onBeforeUnmount(() => runner.stop());
</script>

<template>
  <div
    :class="[
      'terminal',
      'terminal--xmas',
      { 'terminal--minimized': minimized, 'terminal--popped': popped },
    ]"
    @click="
      () => {
        if (typing.isTyping) typing.skipRequested = true;
      }
    "
  >
    <!-- HEADER (fixed) -->
    <header class="terminal__topbar">
      <div class="terminal__controls" aria-hidden>
        <span
          class="terminal__controlDot terminal__controlDot--red"
          role="button"
          tabindex="0"
          @click.stop.prevent="controlClose"
          @keydown.enter.stop.prevent="controlClose"
          @keydown.space.stop.prevent="controlClose"
          aria-label="Cerrar"
          title="Cerrar"
        ></span>
        <span
          class="terminal__controlDot terminal__controlDot--yellow"
          role="button"
          tabindex="0"
          @click.stop.prevent="controlMinimize"
          @keydown.enter.stop.prevent="controlMinimize"
          @keydown.space.stop.prevent="controlMinimize"
          aria-label="Minimizar"
          title="Minimizar"
        ></span>
        <span
          class="terminal__controlDot terminal__controlDot--green"
          role="button"
          tabindex="0"
          @click.stop.prevent="controlMaximize"
          @keydown.enter.stop.prevent="controlMaximize"
          @keydown.space.stop.prevent="controlMaximize"
          aria-label="Maximizar"
          title="Maximizar"
        ></span>
      </div>
      <div class="terminal__title">New Year 2026 — Terminal</div>
      <button class="terminal__btn" @click="restart">Reiniciar</button>
    </header>

    <!-- BODY (scroll only here) -->
    <main ref="scrollRef" class="terminal__output" aria-live="polite">
      <transition-group name="line" tag="div">
        <div v-for="item in outputItems" :key="item.id">
          <div v-if="item.kind === 'line'" class="terminal__line">
            <span v-if="!item.active" class="terminal__outputPrompt">{{
              PROMPT
            }}</span>
            <span class="terminal__outputText">
              {{ item.text
              }}<span v-if="item.active" class="terminal__cursor">|</span>
            </span>
          </div>
          <div v-else class="terminal__line">&nbsp;</div>
        </div>
      </transition-group>
    </main>

    <!-- BOTTOM (fixed) -->
    <footer class="terminal__bottom">
      <div class="terminal__interactive">
        <div
          v-if="hasChoices && ui.choicesPrompt"
          class="terminal__choicesPrompt"
        >
          {{ ui.choicesPrompt }}
        </div>

        <div v-if="hasChoices" class="terminal__choicesContainer">
          <div class="terminal__availableCommands">
            <div class="terminal__commandsLabel">Comandos disponibles:</div>
            <transition-group
              name="cmd"
              tag="div"
              class="terminal__commandsList"
            >
              <button
                v-for="(c, idx) in ui.choices"
                :key="c.id"
                class="terminal__commandBtn"
                @click="choose(c.id)"
              >
                <span class="terminal__commandIndex">[{{ idx + 1 }}]</span>
                <span class="terminal__commandText">{{ c.label }}</span>
              </button>
            </transition-group>
          </div>
        </div>

        <div class="terminal__footerline">
          <div v-if="hasChoices" class="terminal__hint">
            Selecciona una opción para continuar.
          </div>
          <div v-else-if="ui.terminated" class="terminal__hint">
            Fin. Reinicia si quieres volver a sufrir.
          </div>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* Layout: header fixed, footer fixed, center scroll */
.terminal {
  height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    "Liberation Mono", "Courier New", monospace;
  border-radius: 8px;
  overflow: hidden;
}

/* --------- header (fixed) --------- */
.terminal__topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(46, 255, 154, 0.25);
  background: linear-gradient(
    to bottom,
    rgba(0, 170, 255, 0.08),
    rgba(0, 0, 0, 0.3)
  );
  position: relative;
  z-index: 2;
  box-shadow: 0 2px 15px rgba(46, 255, 154, 0.1),
    inset 0 1px 0 rgba(46, 255, 154, 0.1);
}

.terminal__topbar::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(46, 255, 154, 0.6) 50%,
    transparent 100%
  );
  animation: tech-topbar-scan 3s ease-in-out infinite;
}

@keyframes tech-topbar-scan {
  0%,
  100% {
    transform: translateX(-100%);
    opacity: 0;
  }
  50% {
    transform: translateX(100%);
    opacity: 1;
  }
}

.terminal__controls {
  display: flex;
  gap: 8px;
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
}

.terminal__controlDot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.25) inset;
}
.terminal__controlDot[role="button"] {
  cursor: pointer;
  transition: transform 140ms ease, filter 140ms ease;
}
.terminal__controlDot[role="button"]:active {
  transform: scale(0.92);
}
.terminal__controlDot--red[role="button"]:hover {
  box-shadow: 0 0 12px rgba(255, 95, 86, 0.22);
  filter: brightness(1.06);
}
.terminal__controlDot--yellow[role="button"]:hover {
  box-shadow: 0 0 12px rgba(255, 189, 46, 0.22);
  filter: brightness(1.06);
}
.terminal__controlDot--green[role="button"]:hover {
  box-shadow: 0 0 12px rgba(39, 201, 63, 0.22);
  filter: brightness(1.06);
}
.terminal__controlDot[role="button"]:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.06);
  outline-offset: 3px;
}

/* minimized/popped states */
.terminal--minimized .terminal__output,
.terminal--minimized .terminal__bottom {
  display: none;
}
.terminal--popped {
  position: fixed;
  inset: 8px;
  z-index: 9999;
  border-radius: 6px;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.6);
}
.terminal__controlDot--red {
  background: #ff5f56;
}
.terminal__controlDot--yellow {
  background: #ffbd2e;
}
.terminal__controlDot--green {
  background: #27c93f;
}

.terminal__topbar::after {
  content: "";
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: -1px;
  height: 10px;
  pointer-events: none;
  opacity: 0.85;
  animation: xmas-string-lights 4s ease-in-out infinite;
}

@keyframes xmas-string-lights {
  0%,
  100% {
    background: radial-gradient(
          circle,
          rgba(46, 255, 154, 0.75) 0 2px,
          rgba(0, 0, 0, 0) 3px
        )
        0 50% / 34px 10px repeat-x,
      radial-gradient(
          circle,
          rgba(255, 59, 77, 0.7) 0 2px,
          rgba(0, 0, 0, 0) 3px
        )
        17px 50% / 34px 10px repeat-x;
    filter: drop-shadow(0 0 6px rgba(46, 255, 154, 0.3));
  }
  33% {
    background: radial-gradient(
          circle,
          rgba(255, 59, 77, 0.75) 0 2px,
          rgba(0, 0, 0, 0) 3px
        )
        0 50% / 34px 10px repeat-x,
      radial-gradient(
          circle,
          rgba(255, 189, 46, 0.7) 0 2px,
          rgba(0, 0, 0, 0) 3px
        )
        17px 50% / 34px 10px repeat-x;
    filter: drop-shadow(0 0 6px rgba(255, 59, 77, 0.3));
  }
  66% {
    background: radial-gradient(
          circle,
          rgba(255, 189, 46, 0.75) 0 2px,
          rgba(0, 0, 0, 0) 3px
        )
        0 50% / 34px 10px repeat-x,
      radial-gradient(
          circle,
          rgba(0, 170, 255, 0.7) 0 2px,
          rgba(0, 0, 0, 0) 3px
        )
        17px 50% / 34px 10px repeat-x;
    filter: drop-shadow(0 0 6px rgba(255, 189, 46, 0.3));
  }
}

.terminal__title {
  font-size: 14px;
  opacity: 0.92;
  flex: 1;
  text-align: center;
  padding-left: 36px; /* space for control dots */
  margin-right: 12px; /* keep distance from the right-side button */
  color: rgba(201, 247, 255, 0.95);
  text-shadow: 0 0 8px rgba(46, 255, 154, 0.4), 0 0 16px rgba(46, 255, 154, 0.2),
    0 2px 4px rgba(0, 0, 0, 0.5);
  animation: xmas-title-glow 3s ease-in-out infinite;
}

@keyframes xmas-title-glow {
  0%,
  100% {
    text-shadow: 0 0 8px rgba(46, 255, 154, 0.4),
      0 0 16px rgba(46, 255, 154, 0.2), 0 2px 4px rgba(0, 0, 0, 0.5);
  }
  50% {
    text-shadow: 0 0 12px rgba(255, 59, 77, 0.5),
      0 0 20px rgba(255, 59, 77, 0.3), 0 2px 4px rgba(0, 0, 0, 0.5);
  }
}

.terminal__title::before {
  content: "🎄 ";
  font-size: 16px;
  animation: xmas-tree-pulse 2s ease-in-out infinite;
}

@keyframes xmas-tree-pulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.1);
  }
}

.terminal__title::after {
  content: " · 2026 ✨";
  color: rgba(255, 215, 0, 0.95);
  text-shadow: 0 0 10px rgba(255, 215, 0, 0.5), 0 0 20px rgba(255, 215, 0, 0.3);
  animation: xmas-sparkle 1.5s ease-in-out infinite;
}

@keyframes xmas-sparkle {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}

.terminal__btn {
  background: linear-gradient(
    135deg,
    rgba(46, 255, 154, 0.08) 0%,
    rgba(0, 170, 255, 0.08) 100%
  );
  color: rgba(201, 247, 255, 0.9);
  border: 1px solid rgba(46, 255, 154, 0.35);
  padding: 6px 12px;
  border-radius: 999px;
  cursor: pointer;
  transition: all 140ms ease;
  box-shadow: 0 0 10px rgba(46, 255, 154, 0.1),
    inset 0 0 10px rgba(46, 255, 154, 0.05);
  position: relative;
  overflow: hidden;
}

.terminal__btn::before {
  content: "";
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.2),
    transparent
  );
  animation: xmas-btn-shine 3s ease-in-out infinite;
}

@keyframes xmas-btn-shine {
  0% {
    left: -100%;
  }
  50%,
  100% {
    left: 100%;
  }
}

.terminal__btn:hover {
  color: rgba(46, 255, 154, 0.95);
  border-color: rgba(46, 255, 154, 0.8);
  box-shadow: 0 0 20px rgba(46, 255, 154, 0.3),
    0 0 30px rgba(46, 255, 154, 0.15), inset 0 0 15px rgba(46, 255, 154, 0.1);
  transform: translateY(-1px) scale(1.02);
  background: linear-gradient(
    135deg,
    rgba(46, 255, 154, 0.15) 0%,
    rgba(0, 170, 255, 0.15) 100%
  );
}

.terminal__btn:active {
  color: rgba(255, 59, 77, 0.95);
  border-color: rgba(255, 59, 77, 0.6);
  box-shadow: 0 0 14px rgba(255, 59, 77, 0.25);
  transform: translateY(0) scale(0.98);
}

/* --------- scroll area --------- */
.terminal__output {
  overflow: auto;
  padding: 14px;
  padding-bottom: 100px; /* Extra space at bottom so last lines are always visible */
  line-height: 1.45;
  white-space: pre-wrap;
  min-height: 0;
  position: relative;
  z-index: 1;
  background: #000; /* darker terminal background */
  word-break: break-word;
}

.terminal__output::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(46, 255, 154, 0.8) 50%,
    transparent 100%
  );
  box-shadow: 0 0 15px rgba(46, 255, 154, 0.6), 0 0 30px rgba(46, 255, 154, 0.3);
  animation: tech-scan 3s ease-in-out infinite;
  pointer-events: none;
  z-index: 10;
}

@keyframes tech-scan {
  0%,
  100% {
    transform: translateY(0);
    opacity: 0;
  }
  10% {
    opacity: 1;
  }
  90% {
    opacity: 1;
  }
  100% {
    transform: translateY(500px);
    opacity: 0;
  }
}

.terminal__output::after {
  content: "";
  position: absolute;
  inset: 0;
  background-image: repeating-linear-gradient(
      0deg,
      rgba(46, 255, 154, 0.03) 0px,
      transparent 1px,
      transparent 2px,
      rgba(46, 255, 154, 0.03) 3px
    ),
    repeating-linear-gradient(
      90deg,
      rgba(0, 170, 255, 0.02) 0px,
      transparent 1px,
      transparent 2px,
      rgba(0, 170, 255, 0.02) 3px
    );
  pointer-events: none;
  opacity: 0.4;
  animation: tech-grid-pulse 4s ease-in-out infinite;
}

@keyframes tech-grid-pulse {
  0%,
  100% {
    opacity: 0.3;
  }
  50% {
    opacity: 0.5;
  }
}

.terminal__line {
  margin-bottom: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    "Liberation Mono", "Courier New", monospace;
  font-size: 13px;
  letter-spacing: 0.3px;
  display: flex;
  align-items: baseline;
  gap: 6px;
  position: relative;
  padding-left: 4px;
}

.terminal__line::before {
  content: "";
  position: absolute;
  left: 0;
  top: 50%;
  width: 2px;
  height: 60%;
  transform: translateY(-50%);
  background: linear-gradient(
    180deg,
    transparent,
    rgba(46, 255, 154, 0.4),
    transparent
  );
  opacity: 0;
  animation: tech-line-pulse 2s ease-in-out infinite;
}

@keyframes tech-line-pulse {
  0%,
  100% {
    opacity: 0;
  }
  50% {
    opacity: 0.6;
  }
}

.terminal__line:nth-child(3n)::before {
  animation-delay: 0.5s;
  background: linear-gradient(
    180deg,
    transparent,
    rgba(0, 170, 255, 0.4),
    transparent
  );
}

.terminal__line:nth-child(3n + 1)::before {
  animation-delay: 1s;
  background: linear-gradient(
    180deg,
    transparent,
    rgba(255, 59, 77, 0.4),
    transparent
  );
}

.terminal__outputPrompt {
  color: #33ff77;
  text-shadow: 0 0 8px rgba(51, 255, 119, 0.4), 0 0 15px rgba(51, 255, 119, 0.2);
  flex-shrink: 0;
  white-space: nowrap;
  font-weight: 600;
  position: relative;
  animation: tech-prompt-glow 2s ease-in-out infinite;
}

@keyframes tech-prompt-glow {
  0%,
  100% {
    text-shadow: 0 0 8px rgba(51, 255, 119, 0.4),
      0 0 15px rgba(51, 255, 119, 0.2);
  }
  50% {
    text-shadow: 0 0 12px rgba(51, 255, 119, 0.6),
      0 0 20px rgba(51, 255, 119, 0.3), 0 0 30px rgba(51, 255, 119, 0.1);
  }
}

.terminal__outputPrompt::after {
  content: "";
  position: absolute;
  right: -6px;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 3px;
  background: #33ff77;
  border-radius: 50%;
  box-shadow: 0 0 6px rgba(51, 255, 119, 0.8);
  animation: tech-dot-blink 1.5s ease-in-out infinite;
}

@keyframes tech-dot-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

.terminal__outputText {
  color: #cfeff7;
  flex: 1;
}

.terminal__cursor {
  display: inline-block;
  margin-left: 4px;
  color: #33ff77;
  font-weight: 700;
  animation: tech-caret 0.85s steps(1, end) infinite;
  position: relative;
  text-shadow: 0 0 10px rgba(51, 255, 119, 0.6),
    0 0 20px rgba(51, 255, 119, 0.3);
}

.terminal__cursor::before {
  content: "";
  position: absolute;
  left: -3px;
  top: -2px;
  right: -3px;
  bottom: -2px;
  border: 1px solid rgba(51, 255, 119, 0.3);
  animation: tech-cursor-pulse 1.5s ease-in-out infinite;
  pointer-events: none;
}

@keyframes tech-cursor-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.3;
  }
  50% {
    transform: scale(1.2);
    opacity: 0.6;
  }
}

@keyframes tech-caret {
  0%,
  49% {
    opacity: 1;
  }
  50%,
  100% {
    opacity: 0;
  }
}

/* --------- bottom (fixed) --------- */
.terminal__bottom {
  padding: 10px 14px 12px;
  border-top: 1px solid rgba(201, 247, 255, 0.1);
  background: linear-gradient(
    to top,
    rgba(0, 170, 255, 0.04),
    rgba(0, 0, 0, 0)
  );
  position: relative;
  z-index: 2;
}

.terminal__interactive {
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: interactive-fade-in 1.2s ease-out;
}

@keyframes interactive-fade-in {
  0% {
    opacity: 0;
    transform: translateY(5px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

.terminal__inputRow {
  display: flex;
  align-items: center;
  gap: 10px;
}

.terminal__prompt {
  white-space: nowrap;
  letter-spacing: 0.2px;
  color: rgba(46, 255, 154, 0.95);
  text-shadow: 0 0 10px rgba(46, 255, 154, 0.2);
}

.terminal__input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: rgba(201, 247, 255, 0.95);
  font-size: 14px;
  padding: 8px 6px;
  caret-color: rgba(255, 255, 255, 0.95);
  text-shadow: 0 0 10px rgba(0, 170, 255, 0.1);
}

.terminal__input--ghost {
  opacity: 0.75;
  cursor: default;
}

.terminal__choicesPrompt {
  opacity: 0.9;
  white-space: pre-wrap;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(201, 247, 255, 0.15);
}

.terminal__choicesContainer {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.terminal__availableCommands {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.terminal__commandsLabel {
  opacity: 0.7;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: rgba(46, 255, 154, 0.7);
}

.terminal__commandsList {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-left: 2px solid rgba(46, 255, 154, 0.3);
  padding-left: 12px;
}

.terminal__commandBtn {
  background: transparent;
}

.terminal__commandBtn {
  background: transparent;
  color: rgba(201, 247, 255, 0.95);
  border: none;
  padding: 6px 8px;
  cursor: pointer;
  text-align: left;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    "Liberation Mono", "Courier New", monospace;
  font-size: 13px;
  transition: all 140ms ease;
  display: flex;
  gap: 8px;
  align-items: center;
}

.terminal__commandBtn:hover {
  color: rgba(46, 255, 154, 0.95);
  background: rgba(46, 255, 154, 0.05);
  padding-left: 12px;
  text-shadow: 0 0 8px rgba(46, 255, 154, 0.2);
}

.terminal__commandBtn:active {
  color: rgba(255, 59, 77, 0.95);
  background: rgba(255, 59, 77, 0.05);
  text-shadow: 0 0 8px rgba(255, 59, 77, 0.2);
}

.terminal__commandIndex {
  color: rgba(46, 255, 154, 0.6);
  min-width: 24px;
}

.terminal__commandText {
  flex: 1;
}

.terminal__footerline {
  opacity: 0.6;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: rgba(46, 255, 154, 0.5);
  border-top: 1px solid rgba(46, 255, 154, 0.15);
  padding-top: 8px;
  margin-top: 8px;
}

/* ---------------- Xmas tech theme background layers ---------------- */
.terminal--xmas {
  --xmas-bg: #05070b;
  color: #c9f7ff;

  background: radial-gradient(
      900px 480px at 50% 15%,
      rgba(46, 255, 154, 0.15) 0%,
      rgba(0, 0, 0, 0) 60%
    ),
    radial-gradient(
      800px 500px at 75% 25%,
      rgba(255, 59, 77, 0.12) 0%,
      rgba(0, 0, 0, 0) 55%
    ),
    radial-gradient(
      1200px 700px at 50% 70%,
      rgba(0, 170, 255, 0.1) 0%,
      rgba(0, 0, 0, 0) 65%
    ),
    radial-gradient(
      600px 400px at 20% 50%,
      rgba(255, 215, 0, 0.08) 0%,
      rgba(0, 0, 0, 0) 50%
    ),
    linear-gradient(to bottom, #070a10 0%, var(--xmas-bg) 55%, #03040a 100%);
  text-shadow: 0 0 10px rgba(46, 255, 154, 0.15),
    0 0 22px rgba(0, 170, 255, 0.12);

  border: 1px solid rgba(46, 255, 154, 0.25);
  box-shadow: inset 0 0 0 1px rgba(46, 255, 154, 0.1),
    inset 0 0 30px rgba(0, 0, 0, 0.7), 0 0 30px rgba(46, 255, 154, 0.15),
    0 0 60px rgba(255, 59, 77, 0.1), 0 18px 70px rgba(0, 0, 0, 0.7);
  position: relative;
  overflow: hidden;
  animation: xmas-border-glow 4s ease-in-out infinite;
}

@keyframes xmas-border-glow {
  0%,
  100% {
    border-color: rgba(46, 255, 154, 0.25);
    box-shadow: inset 0 0 0 1px rgba(46, 255, 154, 0.1),
      inset 0 0 30px rgba(0, 0, 0, 0.7), 0 0 30px rgba(46, 255, 154, 0.15),
      0 0 60px rgba(255, 59, 77, 0.1), 0 18px 70px rgba(0, 0, 0, 0.7);
  }
  50% {
    border-color: rgba(255, 59, 77, 0.25);
    box-shadow: inset 0 0 0 1px rgba(255, 59, 77, 0.1),
      inset 0 0 30px rgba(0, 0, 0, 0.7), 0 0 30px rgba(255, 59, 77, 0.15),
      0 0 60px rgba(46, 255, 154, 0.1), 0 18px 70px rgba(0, 0, 0, 0.7);
  }
}

.terminal--xmas::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
      to bottom,
      rgba(255, 255, 255, 0.015) 0px,
      rgba(255, 255, 255, 0.015) 1px,
      rgba(0, 0, 0, 0) 3px,
      rgba(0, 0, 0, 0) 6px
    ),
    radial-gradient(
      1100px 600px at 50% 30%,
      rgba(0, 0, 0, 0) 0%,
      rgba(0, 0, 0, 0.25) 60%,
      rgba(0, 0, 0, 0.55) 100%
    );
  opacity: 0.75;
}

.terminal--xmas::after {
  content: "";
  position: absolute;
  inset: -10%;
  pointer-events: none;
  background: radial-gradient(
      circle at 15% 20%,
      rgba(255, 255, 255, 0.08) 0 2px,
      rgba(0, 0, 0, 0) 3px
    ),
    radial-gradient(
      circle at 35% 10%,
      rgba(255, 215, 0, 0.12) 0 2px,
      rgba(0, 0, 0, 0) 4px
    ),
    radial-gradient(
      circle at 60% 18%,
      rgba(255, 255, 255, 0.06) 0 2px,
      rgba(0, 0, 0, 0) 4px
    ),
    radial-gradient(
      circle at 80% 12%,
      rgba(46, 255, 154, 0.1) 0 2px,
      rgba(0, 0, 0, 0) 4px
    ),
    radial-gradient(
      circle at 25% 60%,
      rgba(255, 59, 77, 0.08) 0 2px,
      rgba(0, 0, 0, 0) 4px
    ),
    radial-gradient(
      circle at 70% 75%,
      rgba(255, 215, 0, 0.1) 0 2px,
      rgba(0, 0, 0, 0) 4px
    ),
    radial-gradient(
      circle at 10% 55%,
      rgba(46, 255, 154, 0.12),
      rgba(0, 0, 0, 0) 45%
    ),
    radial-gradient(
      circle at 92% 42%,
      rgba(255, 59, 77, 0.12),
      rgba(0, 0, 0, 0) 45%
    ),
    radial-gradient(
      circle at 50% 30%,
      rgba(0, 170, 255, 0.1),
      rgba(0, 0, 0, 0) 40%
    );
  opacity: 0.65;
  animation: xmas-snow 9s linear infinite, xmas-twinkle 3s ease-in-out infinite;
  transform: translateY(-6%);
}

@keyframes xmas-twinkle {
  0%,
  100% {
    opacity: 0.65;
  }
  50% {
    opacity: 0.85;
  }
}

@keyframes xmas-snow {
  0% {
    transform: translateY(-6%);
  }
  100% {
    transform: translateY(6%);
  }
}

@keyframes xmas-caret {
  0%,
  49% {
    opacity: 1;
  }
  50%,
  100% {
    opacity: 0;
  }
}

/* --------- Animations for entrance --------- */
.line-enter-from {
  opacity: 0;
  transform: translateX(-8px) scale(0.995);
}
.line-enter-active {
  transition: all 260ms cubic-bezier(0.2, 0.9, 0.2, 1);
}
.line-enter-to {
  opacity: 1;
  transform: none;
}

.cmd-enter-from {
  opacity: 0;
  transform: translateX(8px) scale(0.995);
}
.cmd-enter-active {
  transition: all 260ms cubic-bezier(0.2, 0.9, 0.2, 1);
}
.cmd-enter-to {
  opacity: 1;
  transform: none;
}

/* small pulse for title to feel alive */
.terminal__title {
  animation: title-pulse 4.2s ease-in-out infinite;
}
@keyframes title-pulse {
  0% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-1px);
  }
  100% {
    transform: translateY(0);
  }
}
</style>
