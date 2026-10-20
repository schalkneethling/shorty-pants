import { isLayout, type Layout } from "../../src/schemas/layout-names.ts";
import type { Preset } from "../../src/schemas/preset.ts";
import { createLayoutFrame } from "../shared/layout-frame.ts";
import { formatElapsed } from "../shared/time.ts";
import { describeScreenFit, layoutLabel } from "./screen-fit.ts";
import {
  cameraMimeTypes,
  maximumTakeMs,
  pickMimeType,
  readSessionToken,
  screenMimeTypes,
  screenOffsetMs,
} from "./take.ts";

type Track = "cam" | "screen";

// setup: choosing the camera and window. recording: a take is running.
// saving: the take is being uploaded. saved: the take is on disk.
type Phase = "setup" | "recording" | "saving" | "saved";

interface TrackRecording {
  recorder: MediaRecorder;
  // When the recorder started, on the same clock as performance.now().
  startedAt: Promise<number>;
  finished: Promise<Blob>;
}

function requireElement<Element extends HTMLElement>(id: string, type: new () => Element): Element {
  const element = document.getElementById(id);
  if (!(element instanceof type)) {
    throw new Error(`The recorder page is missing #${id}.`);
  }
  return element;
}

const cameraPreview = requireElement("camera-preview", HTMLVideoElement);
const screenPreview = requireElement("screen-preview", HTMLVideoElement);
const cameraButton = requireElement("camera-button", HTMLButtonElement);
const screenButton = requireElement("screen-button", HTMLButtonElement);
const recordButton = requireElement("record-button", HTMLButtonElement);
const stopButton = requireElement("stop-button", HTMLButtonElement);
const elapsed = requireElement("elapsed", HTMLTimeElement);
const status = requireElement("status", HTMLOutputElement);
const previewControls = requireElement("preview-controls", HTMLElement);
const framePreview = requireElement("frame-preview", HTMLElement);
const previewFrame = requireElement("preview-frame", HTMLDivElement);
const frameScroll = requireElement("frame-scroll", HTMLElement);
const frameCaption = requireElement("frame-caption", HTMLElement);
const layoutChoice = requireElement("preview-layout", HTMLFieldSetElement);
const viewSizeChoice = requireElement("view-size", HTMLFieldSetElement);
const safeZonesToggle = requireElement("safe-zones-toggle", HTMLInputElement);
const areasToggle = requireElement("areas-toggle", HTMLInputElement);
const screenFit = requireElement("screen-fit", HTMLOutputElement);
const headlineArea = requireElement("headline-area", HTMLElement);
const captionsArea = requireElement("captions-area", HTMLElement);

const token = readSessionToken(window.location.hash);
const cameraMimeType = pickMimeType(cameraMimeTypes, (type) => MediaRecorder.isTypeSupported(type));
const screenMimeType = pickMimeType(screenMimeTypes, (type) => MediaRecorder.isTypeSupported(type));

const trackNames: Record<Track, string> = { cam: "camera", screen: "screen" };

// How big the frame preview is drawn. Fit fills the height of the window,
// phone is about the width of a phone held upright, and actual shows one
// pixel of the short for each pixel on the screen.
type ViewSize = "fit" | "phone" | "actual";

function isViewSize(value: string): value is ViewSize {
  return value === "fit" || value === "phone" || value === "actual";
}

let phase: Phase = "setup";
let cameraStream: MediaStream | null = null;
let screenStream: MediaStream | null = null;
let recordings: Record<Track, TrackRecording> | null = null;
let timer: number | undefined;
// The preset arrives from the server after the page has loaded. Until then,
// and when it cannot be loaded, there is no frame preview.
let preset: Preset | null = null;
let layoutFrame: ReturnType<typeof createLayoutFrame> | null = null;
let previewLayout: Layout = "split";

function announce(message: string) {
  status.textContent = message;
}

/** Sets every button from the current phase and sources, so no two code paths disagree. */
function updateControls() {
  const isSetup = phase === "setup";
  const hasBothSources = cameraStream !== null && screenStream !== null;

  cameraButton.disabled = !isSetup || cameraStream !== null;
  screenButton.disabled = !isSetup;
  screenButton.textContent = screenStream === null ? "Choose window" : "Choose another window";
  recordButton.disabled = !isSetup || !hasBothSources;

  // While a take is saved, Stop keeps keyboard focus instead of dropping it
  // to the page, so it is marked unavailable rather than disabled.
  const stopIsUnavailable = phase === "saving" || phase === "saved";
  stopButton.disabled = isSetup;
  stopButton.setAttribute("aria-disabled", String(stopIsUnavailable));
}

function focusNextStep() {
  const nextStep = [cameraButton, screenButton, recordButton].find((button) => {
    if (button === cameraButton) {
      return cameraStream === null;
    }
    if (button === screenButton) {
      return screenStream === null;
    }
    return !button.disabled;
  });
  nextStep?.focus();
}

/** Says how much of the shared window the short shows in the preview layout. */
function updateScreenFit() {
  if (preset === null) {
    return;
  }
  const { videoWidth, videoHeight } = screenPreview;
  const hasWindow = screenStream !== null && videoWidth > 0 && videoHeight > 0;
  screenFit.textContent = hasWindow
    ? describeScreenFit({ width: videoWidth, height: videoHeight }, previewLayout, preset.safeZones)
    : "Choose a window to see how much of it the short shows.";
}

/** Switches the layout of the preview only. The recording does not change. */
function showPreviewLayout(layout: Layout) {
  previewLayout = layout;
  layoutFrame?.showLayout(layout, undefined);
  frameCaption.textContent = `Layout: ${layoutLabel(layout)}`;
  updateScreenFit();
}

/** A view wider than its area scrolls, and a keyboard needs a way to scroll it. */
function updateScrollFocus() {
  const isScrollable =
    frameScroll.scrollWidth > frameScroll.clientWidth ||
    frameScroll.scrollHeight > frameScroll.clientHeight;
  if (isScrollable) {
    frameScroll.setAttribute("tabindex", "0");
  } else {
    frameScroll.removeAttribute("tabindex");
  }
}

function showViewSize(view: ViewSize) {
  frameScroll.dataset.view = view;
  updateScrollFocus();
}

async function loadPreset(): Promise<Preset> {
  const response = await fetch("/api/preset", { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) {
    throw new Error(`The server answered ${response.status}.`);
  }
  return (await response.json()) as Preset;
}

/** Shows the frame preview once the preset is known. Recording does not need it. */
async function startFramePreview() {
  try {
    preset = await loadPreset();
  } catch (error) {
    announce(`The frame preview is not available. ${describeError(error)} You can still record.`);
    return;
  }

  layoutFrame = createLayoutFrame(
    {
      frame: previewFrame,
      screenSlot: requireElement("screen-slot", HTMLDivElement),
      cameraSlot: requireElement("camera-slot", HTMLDivElement),
      screenVideo: screenPreview,
      cameraVideo: cameraPreview,
      headline: headlineArea,
      captions: captionsArea,
      safeZones: requireElement("safe-zones", HTMLDivElement),
    },
    preset,
  );
  layoutChoice.querySelectorAll("input").forEach((input) => {
    input.checked = input.value === preset?.defaultLayout;
  });
  showPreviewLayout(preset.defaultLayout);
  layoutFrame.setSafeZonesVisible(safeZonesToggle.checked);
  showAreas(areasToggle.checked);

  previewControls.hidden = false;
  framePreview.hidden = false;
  updateScrollFocus();
}

function showAreas(isVisible: boolean) {
  headlineArea.hidden = !isVisible;
  captionsArea.hidden = !isVisible;
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function showElapsed(milliseconds: number) {
  elapsed.textContent = formatElapsed(milliseconds);
  elapsed.dateTime = `PT${Math.floor(milliseconds / 1000)}S`;
}

function describeError(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Permission was denied. Allow access in the browser and try again.";
  }
  return error instanceof Error ? error.message : String(error);
}

async function turnOnCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    cameraPreview.srcObject = cameraStream;
    await cameraPreview.play();
    announce(
      screenStream === null ? "Camera is on. Now choose a window to share." : "Ready to record.",
    );
  } catch (error) {
    announce(`The camera could not be turned on. ${describeError(error)}`);
  }
  updateControls();
  focusNextStep();
}

function handleShareEnded(endedStream: MediaStream) {
  // Only the current share matters; an earlier one may end after being replaced.
  if (endedStream !== screenStream) {
    return;
  }
  screenStream = null;
  screenPreview.srcObject = null;
  updateScreenFit();

  if (phase === "recording") {
    void stopRecording("Window sharing ended, so the recording stopped. Saving the take.");
    return;
  }
  if (phase === "setup") {
    announce("Window sharing ended. Choose a window to share.");
    updateControls();
  }
}

async function chooseWindow() {
  try {
    const newStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30 } },
      audio: false,
    });
    // Replacing a share stops the previous one, so it does not keep running.
    const previousStream = screenStream;
    screenStream = newStream;
    stopStream(previousStream);

    screenPreview.srcObject = newStream;
    await screenPreview.play();
    newStream.getVideoTracks()[0]?.addEventListener("ended", () => handleShareEnded(newStream));
    announce(cameraStream === null ? "Window chosen. Now turn on the camera." : "Ready to record.");
  } catch (error) {
    announce(`No window was shared. ${describeError(error)}`);
  }
  updateControls();
  focusNextStep();
}

function startTrackRecording(stream: MediaStream, mimeType: string): TrackRecording {
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  });

  // An error before the recorder starts would otherwise leave the save waiting forever.
  const failed = new Promise<never>((_resolve, reject) => {
    recorder.addEventListener(
      "error",
      (event) => reject((event as ErrorEvent).error ?? new Error("The recorder failed.")),
      { once: true },
    );
  });
  failed.catch(() => {});

  const startedAt = Promise.race([
    new Promise<number>((resolve) => {
      recorder.addEventListener("start", (event) => resolve(event.timeStamp), { once: true });
    }),
    failed,
  ]);
  const finished = Promise.race([
    new Promise<Blob>((resolve) => {
      recorder.addEventListener("stop", () => resolve(new Blob(chunks, { type: mimeType })), {
        once: true,
      });
    }),
    failed,
  ]);

  // A timeslice keeps memory use flat by handing over data every second.
  recorder.start(1000);
  return { recorder, startedAt, finished };
}

function stopRecorders(current: Partial<Record<Track, TrackRecording>>) {
  for (const recording of Object.values(current)) {
    if (recording.recorder.state !== "inactive") {
      recording.recorder.stop();
    }
  }
}

function startRecording() {
  if (
    cameraStream === null ||
    screenStream === null ||
    cameraMimeType === null ||
    screenMimeType === null
  ) {
    return;
  }

  const started: Partial<Record<Track, TrackRecording>> = {};
  try {
    started.cam = startTrackRecording(cameraStream, cameraMimeType);
    started.screen = startTrackRecording(screenStream, screenMimeType);
  } catch (error) {
    stopRecorders(started);
    announce(`The recording could not start. ${describeError(error)}`);
    return;
  }

  recordings = { cam: started.cam, screen: started.screen };
  phase = "recording";
  updateControls();
  stopButton.focus();
  announce("Recording. Press Stop when you are done.");

  const startedAt = performance.now();
  showElapsed(0);
  timer = window.setInterval(() => {
    const recordedMs = performance.now() - startedAt;
    showElapsed(Math.min(recordedMs, maximumTakeMs));
    if (recordedMs >= maximumTakeMs) {
      void stopRecording(
        "The take reached three minutes, the Shorts limit, so the recording stopped. Saving the take.",
      );
    }
  }, 250);
}

async function upload(track: Track, recording: Blob) {
  // A busy computer can stop the encoder from producing anything before Stop.
  if (recording.size === 0) {
    throw new Error(`The ${trackNames[track]} recording is empty. Record the take again.`);
  }
  const response = await fetch(`/api/takes/${track}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": recording.type },
    body: recording,
  });
  if (!response.ok) {
    throw new Error(`The server refused the ${trackNames[track]} track. ${await response.text()}`);
  }
}

async function stopRecording(reason = "Saving the take.") {
  // Stop, the end of the share and the three-minute limit can all ask to stop;
  // only the first one saves the take.
  if (phase !== "recording" || recordings === null) {
    return;
  }
  const current = recordings;
  phase = "saving";
  window.clearInterval(timer);
  updateControls();
  announce(reason);
  stopRecorders(current);

  try {
    const [cameraStartedAt, screenStartedAt, cameraRecording, screenRecording] = await Promise.all([
      current.cam.startedAt,
      current.screen.startedAt,
      current.cam.finished,
      current.screen.finished,
    ]);

    await upload("cam", cameraRecording);
    await upload("screen", screenRecording);
    const response = await fetch("/api/takes/done", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        screenOffsetMs: screenOffsetMs({ cameraStartedAt, screenStartedAt }),
      }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }

    phase = "saved";
    stopStream(cameraStream);
    stopStream(screenStream);
    updateControls();
    announce("Saved. You can close this tab and return to the terminal.");
  } catch (error) {
    // The camera, and the window if it is still shared, stay connected, so
    // the take can be recorded again.
    phase = "setup";
    recordings = null;
    updateControls();
    focusNextStep();
    announce(`The take could not be saved. ${describeError(error)}`);
  }
}

function initialise() {
  if (token === null) {
    phase = "saved";
    updateControls();
    stopButton.disabled = true;
    announce(
      "Open the recorder with short record. This page needs the address that command prints.",
    );
    return;
  }
  if (cameraMimeType === null || screenMimeType === null) {
    phase = "saved";
    updateControls();
    stopButton.disabled = true;
    announce(
      "This browser cannot record WebM video. Open the address in Chrome or another Chromium browser.",
    );
    return;
  }

  updateControls();
  layoutChoice.addEventListener("change", (event) => {
    const { value } = event.target as HTMLInputElement;
    if (isLayout(value)) {
      showPreviewLayout(value);
    }
  });
  viewSizeChoice.addEventListener("change", (event) => {
    const { value } = event.target as HTMLInputElement;
    if (isViewSize(value)) {
      showViewSize(value);
    }
  });
  safeZonesToggle.addEventListener("change", () =>
    layoutFrame?.setSafeZonesVisible(safeZonesToggle.checked),
  );
  areasToggle.addEventListener("change", () => showAreas(areasToggle.checked));
  // The window can be resized while it is shared, which changes what it shows.
  screenPreview.addEventListener("loadedmetadata", updateScreenFit);
  screenPreview.addEventListener("resize", updateScreenFit);
  new ResizeObserver(updateScrollFocus).observe(frameScroll);
  void startFramePreview();
  cameraButton.addEventListener("click", () => void turnOnCamera());
  screenButton.addEventListener("click", () => void chooseWindow());
  recordButton.addEventListener("click", startRecording);
  stopButton.addEventListener("click", () => void stopRecording());
}

initialise();
