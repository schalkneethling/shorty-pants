import { captionAt, chunkCaptions, keptWords, type CaptionChunk } from "../../src/edit/captions.ts";
import { computeKeepRanges, type KeepRange } from "../../src/edit/cut-list.ts";
import { clampCrop } from "../../src/edit/layout-geometry.ts";
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
import { applyLayout, layoutAtTime, layoutAtWord } from "../../src/edit/segments.ts";
import { isLayout, type Layout } from "../../src/schemas/layout-names.ts";
import { isSameWord } from "../../src/schemas/headline-words.ts";
import type { Preset } from "../../src/schemas/preset.ts";
import type { RecordedTakes } from "../../src/schemas/recorded-takes.ts";
import type { ShortProject } from "../../src/schemas/short-project.ts";
import type { Transcript } from "../../src/schemas/transcript.ts";
import { formatElapsed, formatPrecise } from "../shared/time.ts";
import { readSessionToken } from "../recorder/take.ts";
import { accentChoices, createPreview } from "./preview.ts";
import { nextFocusIndex, selectionBetween } from "./selection.ts";

interface Project {
  recordedTakes: RecordedTakes;
  transcript: Transcript;
  short: ShortProject;
  preset: Preset;
  media: { cam: string; screen: string };
}

type Headline = NonNullable<ShortProject["headline"]>;
type ScreenCrop = NonNullable<ShortProject["screenCrop"]>;

const layoutNames: Record<Layout, string> = {
  split: "Split",
  face: "Face",
  circle: "Circle cam",
};

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
const wordsList = requireElement("words", HTMLDivElement);
const trimStartInput = requireElement("trim-start", HTMLInputElement);
const trimEndInput = requireElement("trim-end", HTMLInputElement);
const trimStartValue = requireElement("trim-start-value", HTMLSpanElement);
const trimEndValue = requireElement("trim-end-value", HTMLSpanElement);
const lengthText = requireElement("length", HTMLParagraphElement);
const doneButton = requireElement("done-button", HTMLButtonElement);
const status = requireElement("status", HTMLOutputElement);
const layoutChoice = requireElement("layout-choice", HTMLFieldSetElement);
const headlineInput = requireElement("headline-text", HTMLInputElement);
const accentSelect = requireElement("headline-accent", HTMLSelectElement);
const cropFieldset = requireElement("screen-crop", HTMLFieldSetElement);
const cropInputs = {
  x: requireElement("crop-x", HTMLInputElement),
  y: requireElement("crop-y", HTMLInputElement),
  width: requireElement("crop-width", HTMLInputElement),
  height: requireElement("crop-height", HTMLInputElement),
};
const cropResetButton = requireElement("crop-reset", HTMLButtonElement);
const safeZonesToggle = requireElement("safe-zones-toggle", HTMLInputElement);
const desktopSafeZonesSwitch = requireElement("desktop-safe-zones", HTMLInputElement);
const headlineHelp = requireElement("headline-help", HTMLParagraphElement);

const token = readSessionToken(window.location.hash);

let project: Project | undefined;
let removedWords: RemovedWordRanges = [];
let trim = { startMs: 0, endMs: 0 };
let keepRanges: KeepRange[] = [];
let selection: number[] = [];
let selectionAnchor: number | null = null;
let focusIndex = 0;
let wordOptions: HTMLElement[] = [];
let saveTimer: number | undefined;
// Resolves to whether the latest save reached short.json.
let pendingSave: Promise<boolean> = Promise.resolve(true);
let isPlaying = false;
let segments: ShortProject["segments"] = [];
let headline: Headline | undefined;
let screenCrop: ScreenCrop | undefined;
// The accent word picked in the list. Until one is picked, or while the
// picked word is missing from the headline, the last word is the accent.
let chosenAccent: string | undefined;
let captionChunks: CaptionChunk[] = [];
let preview: ReturnType<typeof createPreview> | undefined;

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
  captionChunks = chunkCaptions(
    keptWords(transcript.words, keepRanges),
    currentProject().preset.captions,
    keepRanges,
  );
  const lengthMs = keptDurationMs(keepRanges);
  const limit = lengthMs > shortsLimitMs ? " That is longer than the 3:00 a Short can be." : "";
  lengthText.textContent = `The short is ${formatElapsed(lengthMs)} long. Shorts can be up to 3:00.${limit}`;
}

function updateWords() {
  const removed = removedRangesToIndexes(removedWords);
  const { words } = currentProject().transcript;
  const segmentStarts = new Map(segments.map((segment) => [segment.fromWord, segment.layout]));
  wordOptions.forEach((option, index) => {
    const word = words[index]!;
    const isCut = removed.has(index);
    const isOutsideTrim = word.endMs <= trim.startMs || word.startMs >= trim.endMs;
    option.setAttribute("aria-selected", String(selection.includes(index)));
    option.classList.toggle("is-cut", isCut);
    option.classList.toggle("is-outside-trim", isOutsideTrim && !isCut);
    option.tabIndex = index === focusIndex ? 0 : -1;

    // The visible line-through, dimming and layout marker are repeated as text
    // for screen readers. Browsers put a space before the hidden note, so it
    // reads as a parenthetical. The first segment always starts at word 0, so
    // only the later ones are worth a mention.
    const startingLayout = index > 0 ? segmentStarts.get(index) : undefined;
    option.classList.toggle("starts-layout", startingLayout !== undefined);
    const note = option.querySelector(".visually-hidden")!;
    note.textContent = describeWordState({ isCut, isOutsideTrim, startingLayout });
  });
  syncLayoutChoice();
}

/** The hidden note for a word, such as "(cut, face layout starts)", or nothing. */
function describeWordState(state: {
  isCut: boolean;
  isOutsideTrim: boolean;
  startingLayout: Layout | undefined;
}): string {
  const notes: string[] = [];
  if (state.isCut) {
    notes.push("cut");
  } else if (state.isOutsideTrim) {
    notes.push("outside the trim");
  }
  if (state.startingLayout !== undefined) {
    notes.push(`${layoutNames[state.startingLayout].toLowerCase()} layout starts`);
  }
  return notes.length > 0 ? `(${notes.join(", ")})` : "";
}

/**
 * Checks the radio button for the layout of the selected words. When they
 * use more than one layout, no radio button is checked, so any layout can
 * be chosen for all of them.
 */
function syncLayoutChoice() {
  const target = selection.length > 0 ? selection : [focusIndex];
  const layouts = new Set(target.map((index) => layoutAtWord(segments, index)));
  const sharedLayout = layouts.size === 1 ? [...layouts][0] : undefined;
  for (const radio of layoutChoice.querySelectorAll<HTMLInputElement>('input[name="layout"]')) {
    radio.checked = radio.value === sharedLayout;
  }
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

/** Saves the trim and the cuts, and resolves to whether short.json was updated. */
async function save(): Promise<boolean> {
  try {
    // null tells the server to remove a headline or crop that was cleared.
    const changes = {
      trim,
      removedWords,
      segments,
      headline: headline ?? null,
      screenCrop: screenCrop ?? null,
    };
    await api("/short", { method: "PUT", body: JSON.stringify(changes) });
    return true;
  } catch (error) {
    // Only a failure is announced, so the status keeps describing the last edit.
    announce(
      `The changes could not be saved. ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    pendingSave = pendingSave.then(save);
  }, saveDelayMs);
}

/**
 * Saves the current edits once more, after any save still in flight, and
 * resolves to whether they reached short.json. Saving again, rather than
 * only waiting, also retries a save that failed earlier.
 */
function saveNow(): Promise<boolean> {
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  pendingSave = pendingSave.then(save);
  return pendingSave;
}

function moveFocus(index: number) {
  focusIndex = index;
  updateWords();
  wordOptions[index]?.focus();
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
  wordOptions.forEach((option, index) => {
    const word = words[index]!;
    option.classList.toggle(
      "is-playing",
      isPlaying && cameraMs >= word.startMs && cameraMs < word.endMs,
    );
  });

  // The layout switches at the same moment as in the render.
  preview?.showLayout(layoutAtTime(words, segments, cameraMs), screenCrop);
  preview?.showCaption(captionAt(captionChunks, cameraMs));
}

/** The current position of the preview, in camera time. */
function previewMs(): number {
  return cameraVideo.currentTime * 1000;
}

function changeLayout(layout: Layout) {
  const target = selection.length > 0 ? selection : [focusIndex];
  const { words } = currentProject().transcript;
  segments = applyLayout(
    segments,
    { fromWord: Math.min(...target), toWord: Math.max(...target) },
    layout,
    words.length,
  );
  updateWords();
  showPosition(previewMs());
  announce(`${layoutNames[layout]} layout for ${describeTarget(target)}.`);
  scheduleSave();
}

/**
 * Fills the accent list with the headline's words and returns the accent:
 * the chosen word while the headline has it, otherwise the last word.
 */
function showAccentChoices(text: string): string | undefined {
  const choices = accentChoices(text);
  accentSelect.replaceChildren(...choices.map((word) => new Option(word, word)));
  accentSelect.disabled = choices.length === 0;
  const chosen = chosenAccent;
  const chosenWord =
    chosen === undefined ? undefined : choices.find((word) => isSameWord(word, chosen));
  const accent = chosenWord ?? choices.at(-1);
  if (accent !== undefined) {
    accentSelect.value = accent;
  }
  return accent;
}

function changeHeadline() {
  const text = headlineInput.value.trim();
  const accent = showAccentChoices(text);
  headline = accent === undefined ? undefined : { text, accent };
  showHeadline();
  scheduleSave();
}

function changeAccent() {
  if (headline === undefined) {
    return;
  }
  chosenAccent = accentSelect.value;
  headline = { ...headline, accent: chosenAccent };
  showHeadline();
  scheduleSave();
}

let isHeadlineTooLong = false;

/** Draws the headline in the preview and says whether it fits in its two lines. */
function showHeadline() {
  if (preview === undefined) {
    return;
  }
  const fits = preview.showHeadline(headline);
  headlineHelp.textContent = fits
    ? "The headline fits in two lines."
    : "The headline is too long for two lines. Shorten it so all of it shows.";
  // Announced once, when the headline grows past the space it has.
  if (!fits && !isHeadlineTooLong) {
    announce("The headline is too long for two lines.");
  }
  isHeadlineTooLong = !fits;
}

function showCropInputs(crop: ScreenCrop) {
  for (const field of ["x", "y", "width", "height"] as const) {
    cropInputs[field].value = String(crop[field]);
  }
}

/** The whole shared window, which is what the preview shows without a crop. */
function fullScreenCrop(): ScreenCrop {
  return { x: 0, y: 0, width: screenVideo.videoWidth, height: screenVideo.videoHeight };
}

function isSameCrop(first: ScreenCrop, second: ScreenCrop): boolean {
  return (
    first.x === second.x &&
    first.y === second.y &&
    first.width === second.width &&
    first.height === second.height
  );
}

/**
 * Reads the crop fields once a value is committed, keeping the crop inside
 * the shared window. Waiting for the change event, rather than reacting to
 * every key, means a half-typed value never rewrites the other fields.
 */
function changeCrop() {
  const typedCrop = {
    x: readWholeNumber(cropInputs.x, 0),
    y: readWholeNumber(cropInputs.y, 0),
    width: readWholeNumber(cropInputs.width, 1),
    height: readWholeNumber(cropInputs.height, 1),
  };
  screenCrop = clampCrop(typedCrop, windowSize());
  showCropInputs(screenCrop);
  if (!isSameCrop(typedCrop, screenCrop)) {
    announce("The crop was changed to stay inside the window.");
  }
  showPosition(previewMs());
  scheduleSave();
}

/** A field's value as a whole number, or the fallback when the field is empty or invalid. */
function readWholeNumber(input: HTMLInputElement, fallback: number): number {
  const value = Number(input.value);
  const isUsable = input.value.trim() !== "" && Number.isFinite(value);
  return isUsable ? Math.round(value) : fallback;
}

function windowSize() {
  return { width: screenVideo.videoWidth, height: screenVideo.videoHeight };
}

function resetCrop() {
  screenCrop = undefined;
  showCropInputs(fullScreenCrop());
  showPosition(previewMs());
  announce("The crop is reset, so the whole window shows.");
  scheduleSave();
}

/** The crop fields can only be filled in once the window's size is known. */
function enableCrop() {
  const { videoWidth, videoHeight } = screenVideo;
  cropInputs.x.max = String(videoWidth - 1);
  cropInputs.y.max = String(videoHeight - 1);
  cropInputs.width.max = String(videoWidth);
  cropInputs.height.max = String(videoHeight);
  // A crop saved for an earlier, larger recording is brought inside this one.
  if (screenCrop !== undefined) {
    const fittedCrop = clampCrop(screenCrop, windowSize());
    if (!isSameCrop(fittedCrop, screenCrop)) {
      screenCrop = fittedCrop;
      announce("The saved crop was larger than the window, so it now fits inside it.");
      scheduleSave();
    }
  }
  showCropInputs(screenCrop ?? fullScreenCrop());
  showPosition(previewMs());
  cropFieldset.disabled = false;
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

/**
 * Names the words an action applies to: the word itself, a count, or "the
 * short" when the transcript has no words, as for a silent take.
 */
function describeTarget(target: number[]): string {
  const { words } = currentProject().transcript;
  const singleWord = target.length === 1 ? words[target[0]!] : undefined;
  if (singleWord !== undefined) {
    return singleWord.text;
  }
  return words.length === 0 ? "the short" : `${target.length} words`;
}

/** Describes a cut or a restore for the status, such as "Cut positioning." */
function describeToggle(target: number[], isNowCut: boolean): string {
  return `${isNowCut ? "Cut" : "Restored"} ${describeTarget(target)}.`;
}

function toggleCut() {
  const target = selection.length > 0 ? selection : [focusIndex];
  removedWords = toggleRemoved(removedWords, target);
  const isNowCut = removedRangesToIndexes(removedWords).has(target[0]!);
  update();
  announce(describeToggle(target, isNowCut));
  scheduleSave();
}

function handleWordKeys(event: KeyboardEvent) {
  const wordCount = wordOptions.length;
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    toggleCut();
    return;
  }
  if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    selectWord(focusIndex, event.shiftKey);
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
  } else {
    // As in a text editor, moving without Shift moves the selection along,
    // so Delete always acts on the word in focus.
    selection = [next];
    selectionAnchor = next;
  }
  moveFocus(next);
}

/**
 * The words are the options of a multi-select listbox. A listbox, unlike a
 * group of buttons, tells screen readers that the arrow keys belong to the
 * page, and it has a selected state for every word.
 */
function renderWords() {
  const { words } = currentProject().transcript;
  wordOptions = words.map((word, index) => {
    const option = document.createElement("span");
    option.setAttribute("role", "option");
    option.className = "word";
    option.append(word.text);
    const note = document.createElement("span");
    note.className = "visually-hidden";
    option.append(note);
    option.addEventListener("click", (event) => selectWord(index, event.shiftKey));
    return option;
  });
  wordsList.replaceChildren(...wordOptions);
  wordsList.addEventListener("keydown", handleWordKeys);
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

/**
 * The screen recording starts screenOffsetMs after the camera. Before that
 * moment the screen video holds its first frame; after it, the screen video
 * plays and is moved back into step when it drifts.
 */
function keepScreenInStep(cameraMs: number, screenOffsetMs: number) {
  const isBeforeScreenStarts = cameraMs < screenOffsetMs;
  if (isBeforeScreenStarts) {
    if (!screenVideo.paused) {
      screenVideo.pause();
    }
    return;
  }
  if (screenVideo.paused) {
    // A failed or interrupted play only leaves the screen on its last frame,
    // and the next frame tries again, so the error is not announced.
    screenVideo.play().catch(() => {});
  }
  const screenTargetMs = screenTimeMs(cameraMs, screenOffsetMs);
  if (Math.abs(screenVideo.currentTime * 1000 - screenTargetMs) > maximumDriftMs) {
    screenVideo.currentTime = screenTargetMs / 1000;
  }
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
    keepScreenInStep(cameraMs, screenOffsetMs);
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
    // Pause while play() is still starting rejects it with an AbortError,
    // which is not a problem with the preview.
    const isInterruptedByPause = error instanceof DOMException && error.name === "AbortError";
    if (isInterruptedByPause) {
      return;
    }
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
    const isSaved = await saveNow();
    if (!isSaved) {
      doneButton.disabled = false;
      announce(
        "The latest changes could not be saved, so the editor stays open. Press Done to try again.",
      );
      return;
    }
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
  segments = project.short.segments;
  headline = project.short.headline;
  screenCrop = project.short.screenCrop;
  preview = createPreview(
    {
      frame: requireElement("preview-frame", HTMLDivElement),
      screenSlot: requireElement("screen-slot", HTMLDivElement),
      cameraSlot: requireElement("camera-slot", HTMLDivElement),
      screenVideo,
      cameraVideo,
      headline: requireElement("headline-preview", HTMLParagraphElement),
      captions: requireElement("captions-preview", HTMLParagraphElement),
      safeZones: requireElement("safe-zones", HTMLDivElement),
    },
    project.preset,
  );
  preview.showDesktopSafeZones(desktopSafeZonesSwitch.checked);
  headlineInput.value = headline?.text ?? "";
  // A saved accent that is the last word may only be the default, so it is
  // treated as chosen only when it is another word.
  const lastHeadlineWord = accentChoices(headline?.text ?? "").at(-1);
  const isSavedAccentChosen =
    headline !== undefined &&
    lastHeadlineWord !== undefined &&
    !isSameWord(headline.accent, lastHeadlineWord);
  chosenAccent = isSavedAccentChosen ? headline?.accent : undefined;
  showAccentChoices(headline?.text ?? "");
  showHeadline();
  // The headline's size depends on the font, which may still be loading.
  void document.fonts.ready.then(showHeadline);
  for (const input of [trimStartInput, trimEndInput]) {
    input.max = String(project.transcript.durationMs);
    input.disabled = false;
  }
  cameraVideo.src = project.media.cam;
  screenVideo.src = project.media.screen;

  renderWords();
  update();
  seekTo(keepRanges[0]?.startMs ?? 0);

  if (screenVideo.readyState >= HTMLMediaElement.HAVE_METADATA) {
    enableCrop();
  } else {
    screenVideo.addEventListener("loadedmetadata", enableCrop, { once: true });
  }
  screenVideo.addEventListener("error", () =>
    announce("The window recording could not be loaded, so the preview cannot show or crop it."),
  );
  layoutChoice.addEventListener("change", (event) => {
    const { value } = event.target as HTMLInputElement;
    if (isLayout(value)) {
      changeLayout(value);
    }
  });
  headlineInput.addEventListener("input", changeHeadline);
  accentSelect.addEventListener("change", changeAccent);
  for (const input of Object.values(cropInputs)) {
    input.addEventListener("change", changeCrop);
  }
  cropResetButton.addEventListener("click", resetCrop);
  safeZonesToggle.addEventListener("change", () =>
    preview?.setSafeZonesVisible(safeZonesToggle.checked),
  );
  desktopSafeZonesSwitch.addEventListener("change", () =>
    preview?.showDesktopSafeZones(desktopSafeZonesSwitch.checked),
  );
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
  // Browsers stop animation frames in a hidden tab, so the cuts could not be
  // skipped there; the preview pauses instead.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && isPlaying) {
      stopPlayback();
    }
  });
  playButton.disabled = false;
  doneButton.disabled = false;
  layoutChoice.disabled = false;
  headlineInput.disabled = false;
  announce("Ready. Select words to cut them or change their layout, or move the trim handles.");
}

void initialise();
