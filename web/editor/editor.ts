import { computeKeepRanges, type KeepRange } from "../../src/edit/cut-list.ts";
import {
  keptDurationMs,
  nextPlayableMs,
  screenTimeMs,
  shortTimeMs,
} from "../../src/edit/playback.ts";
import {
  removedRangesToIndexes,
  toggleRemoved,
  type RemovedWordRanges,
} from "../../src/edit/removed-words.ts";
import type { RecordedTakes } from "../../src/schemas/recorded-takes.ts";
import type { ShortProject } from "../../src/schemas/short-project.ts";
import type { Transcript } from "../../src/schemas/transcript.ts";
import { formatElapsed, formatPrecise } from "../shared/time.ts";
import { readSessionToken } from "../recorder/take.ts";
import { nextFocusIndex, selectionBetween } from "./selection.ts";

interface Project {
  recordedTakes: RecordedTakes;
  transcript: Transcript;
  short: ShortProject;
  media: { cam: string; screen: string };
}

// YouTube treats vertical videos of up to three minutes as Shorts.
const shortsLimitMs = 180_000;
// The trim handles never come closer than this, so the short is never empty.
const minimumTrimMs = 100;
const saveDelayMs = 300;
// How far the screen video may drift from the camera before it is corrected.
const maximumDriftMs = 150;

function requireElement<Element extends HTMLElement>(id: string, type: new () => Element): Element {
  const element = document.getElementById(id);
  if (!(element instanceof type)) {
    throw new Error(`The editor page is missing #${id}.`);
  }
  return element;
}

const cameraVideo = requireElement("camera-video", HTMLVideoElement);
const screenVideo = requireElement("screen-video", HTMLVideoElement);
const playButton = requireElement("play-button", HTMLButtonElement);
const position = requireElement("position", HTMLTimeElement);
const wordsGroup = requireElement("words", HTMLDivElement);
const trimStartInput = requireElement("trim-start", HTMLInputElement);
const trimEndInput = requireElement("trim-end", HTMLInputElement);
const trimStartValue = requireElement("trim-start-value", HTMLSpanElement);
const trimEndValue = requireElement("trim-end-value", HTMLSpanElement);
const lengthText = requireElement("length", HTMLParagraphElement);
const doneButton = requireElement("done-button", HTMLButtonElement);
const status = requireElement("status", HTMLOutputElement);

const token = readSessionToken(window.location.hash);

let project: Project | undefined;
let removedWords: RemovedWordRanges = [];
let trim = { startMs: 0, endMs: 0 };
let keepRanges: KeepRange[] = [];
let selection: number[] = [];
let selectionAnchor: number | null = null;
let focusIndex = 0;
let wordButtons: HTMLButtonElement[] = [];
let saveTimer: number | undefined;
let pendingSave: Promise<void> = Promise.resolve();
let isPlaying = false;

function announce(message: string) {
  status.textContent = message;
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response;
}

function currentProject(): Project {
  if (project === undefined) {
    throw new Error("The short is not loaded yet.");
  }
  return project;
}

function updateKeepRanges() {
  const { transcript, short } = currentProject();
  keepRanges = computeKeepRanges({
    words: transcript.words,
    trim,
    removedWords,
    pauseThresholdMs: short.pauseThresholdMs,
  });
  const lengthMs = keptDurationMs(keepRanges);
  const limit = lengthMs > shortsLimitMs ? " That is longer than the 3:00 a Short can be." : "";
  lengthText.textContent = `The short is ${formatElapsed(lengthMs)} long. Shorts can be up to 3:00.${limit}`;
}

function updateWords() {
  const removed = removedRangesToIndexes(removedWords);
  const { words } = currentProject().transcript;
  wordButtons.forEach((button, index) => {
    const word = words[index]!;
    const isCut = removed.has(index);
    const isOutsideTrim = word.endMs <= trim.startMs || word.startMs >= trim.endMs;
    button.setAttribute("aria-pressed", String(selection.includes(index)));
    button.classList.toggle("is-cut", isCut);
    button.classList.toggle("is-outside-trim", isOutsideTrim && !isCut);
    button.tabIndex = index === focusIndex ? 0 : -1;

    // The visible line-through and dimming are repeated as text for screen readers.
    // Browsers put a space before the hidden note, so it reads as a parenthetical.
    const note = button.querySelector(".visually-hidden")!;
    note.textContent = isCut ? "(cut)" : isOutsideTrim ? "(outside the trim)" : "";
  });
}

function updateTrimInputs() {
  trimStartInput.value = String(trim.startMs);
  trimEndInput.value = String(trim.endMs);
  for (const [input, display, value] of [
    [trimStartInput, trimStartValue, trim.startMs],
    [trimEndInput, trimEndValue, trim.endMs],
  ] as const) {
    input.setAttribute("aria-valuetext", formatPrecise(value));
    display.textContent = formatPrecise(value);
  }
}

function update() {
  updateKeepRanges();
  updateWords();
  updateTrimInputs();
}

async function save() {
  announce("Saving.");
  try {
    await api("/short", { method: "PUT", body: JSON.stringify({ trim, removedWords }) });
    announce("Saved.");
  } catch (error) {
    announce(
      `The changes could not be saved. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    pendingSave = pendingSave.then(save);
  }, saveDelayMs);
}

/** Saves a change that is still waiting for its delay, then waits for every save. */
async function flushSaves() {
  if (saveTimer !== undefined) {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
    pendingSave = pendingSave.then(save);
  }
  await pendingSave;
}

function moveFocus(index: number) {
  focusIndex = index;
  updateWords();
  wordButtons[index]?.focus();
}

function seekTo(cameraMs: number) {
  const { screenOffsetMs } = currentProject().recordedTakes.takes;
  cameraVideo.currentTime = cameraMs / 1000;
  screenVideo.currentTime = screenTimeMs(cameraMs, screenOffsetMs) / 1000;
  showPosition(cameraMs);
}

function showPosition(cameraMs: number) {
  const shortMs = shortTimeMs(keepRanges, cameraMs);
  position.textContent = formatElapsed(shortMs);
  position.dateTime = `PT${Math.floor(shortMs / 1000)}S`;

  const { words } = currentProject().transcript;
  wordButtons.forEach((button, index) => {
    const word = words[index]!;
    button.classList.toggle(
      "is-playing",
      isPlaying && cameraMs >= word.startMs && cameraMs < word.endMs,
    );
  });
}

function selectWord(index: number, extend: boolean) {
  if (extend && selectionAnchor !== null) {
    selection = selectionBetween(selectionAnchor, index);
  } else {
    selection = [index];
    selectionAnchor = index;
  }
  moveFocus(index);
  if (!isPlaying) {
    seekTo(currentProject().transcript.words[index]!.startMs);
  }
}

function toggleCut() {
  const target = selection.length > 0 ? selection : [focusIndex];
  removedWords = toggleRemoved(removedWords, target);
  update();
  scheduleSave();
}

function handleWordKeys(event: KeyboardEvent) {
  const wordCount = wordButtons.length;
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    toggleCut();
    return;
  }
  if (event.key === "Escape") {
    selection = [];
    selectionAnchor = null;
    updateWords();
    return;
  }

  const next = nextFocusIndex(focusIndex, event.key, wordCount);
  if (next === null) {
    return;
  }
  event.preventDefault();
  if (event.shiftKey) {
    selectionAnchor ??= focusIndex;
    selection = selectionBetween(selectionAnchor, next);
  }
  moveFocus(next);
}

function renderWords() {
  const { words } = currentProject().transcript;
  wordButtons = words.map((word, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "word";
    button.append(word.text);
    const note = document.createElement("span");
    note.className = "visually-hidden";
    button.append(note);
    button.addEventListener("click", (event) => selectWord(index, event.shiftKey));
    return button;
  });
  wordsGroup.replaceChildren(...wordButtons);
  wordsGroup.addEventListener("keydown", handleWordKeys);
}

function changeTrim(edge: "start" | "end") {
  const startMs = Number(trimStartInput.value);
  const endMs = Number(trimEndInput.value);
  trim =
    edge === "start"
      ? { startMs: Math.min(startMs, trim.endMs - minimumTrimMs), endMs: trim.endMs }
      : { startMs: trim.startMs, endMs: Math.max(endMs, trim.startMs + minimumTrimMs) };
  update();
  scheduleSave();
}

function stopPlayback() {
  isPlaying = false;
  cameraVideo.pause();
  screenVideo.pause();
  playButton.textContent = "Play";
  showPosition(cameraVideo.currentTime * 1000);
}

/** Runs every frame while playing: jumps over cuts and keeps the screen in step. */
function followPlayback() {
  if (!isPlaying) {
    return;
  }
  const { screenOffsetMs } = currentProject().recordedTakes.takes;
  const cameraMs = cameraVideo.currentTime * 1000;
  const playableMs = nextPlayableMs(keepRanges, cameraMs);

  if (playableMs === null || cameraVideo.ended) {
    stopPlayback();
    return;
  }
  if (playableMs > cameraMs) {
    seekTo(playableMs);
  } else {
    const screenTargetMs = screenTimeMs(cameraMs, screenOffsetMs);
    if (Math.abs(screenVideo.currentTime * 1000 - screenTargetMs) > maximumDriftMs) {
      screenVideo.currentTime = screenTargetMs / 1000;
    }
    showPosition(cameraMs);
  }
  requestAnimationFrame(followPlayback);
}

async function startPlayback() {
  const fromMs =
    nextPlayableMs(keepRanges, cameraVideo.currentTime * 1000) ?? keepRanges[0]?.startMs;
  if (fromMs === undefined) {
    announce("There is nothing left to play. Bring back some words or move the trim handles.");
    return;
  }
  seekTo(fromMs);
  isPlaying = true;
  playButton.textContent = "Pause";
  try {
    await Promise.all([cameraVideo.play(), screenVideo.play()]);
  } catch (error) {
    stopPlayback();
    announce(
      `The preview could not play. ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }
  requestAnimationFrame(followPlayback);
}

async function finishEditing() {
  stopPlayback();
  doneButton.disabled = true;
  try {
    await flushSaves();
    await api("/done", { method: "POST" });
    announce("Done. Your edits are saved. You can close this tab and return to the terminal.");
  } catch (error) {
    doneButton.disabled = false;
    announce(
      `The editor could not finish. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function initialise() {
  if (token === null) {
    announce("Open the editor with short edit. This page needs the address that command prints.");
    return;
  }

  try {
    project = (await (await api("/project")).json()) as Project;
  } catch (error) {
    announce(
      `The short could not be loaded. ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  removedWords = project.short.removedWords;
  trim = project.short.trim;
  for (const input of [trimStartInput, trimEndInput]) {
    input.max = String(project.transcript.durationMs);
    input.disabled = false;
  }
  cameraVideo.src = project.media.cam;
  screenVideo.src = project.media.screen;

  renderWords();
  update();
  seekTo(keepRanges[0]?.startMs ?? 0);

  trimStartInput.addEventListener("input", () => changeTrim("start"));
  trimEndInput.addEventListener("input", () => changeTrim("end"));
  playButton.addEventListener("click", () => {
    if (isPlaying) {
      stopPlayback();
    } else {
      void startPlayback();
    }
  });
  doneButton.addEventListener("click", () => void finishEditing());
  playButton.disabled = false;
  doneButton.disabled = false;
  announce("Ready. Select words to cut them, or move the trim handles.");
}

void initialise();
