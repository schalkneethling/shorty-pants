import {
  cameraMimeTypes,
  formatElapsed,
  maximumTakeMs,
  pickMimeType,
  readSessionToken,
  screenMimeTypes,
  screenOffsetMs,
} from "./take.ts";

type Track = "cam" | "screen";

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

const token = readSessionToken(window.location.hash);
const cameraMimeType = pickMimeType(cameraMimeTypes, (type) => MediaRecorder.isTypeSupported(type));
const screenMimeType = pickMimeType(screenMimeTypes, (type) => MediaRecorder.isTypeSupported(type));

let cameraStream: MediaStream | null = null;
let screenStream: MediaStream | null = null;
let recordings: Record<Track, TrackRecording> | null = null;
let timer: number | undefined;

function announce(message: string) {
  status.textContent = message;
}

function disableAll() {
  for (const button of [cameraButton, screenButton, recordButton, stopButton]) {
    button.disabled = true;
  }
}

function updateRecordButton() {
  recordButton.disabled = cameraStream === null || screenStream === null || recordings !== null;
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
    cameraButton.disabled = true;
    announce(
      screenStream === null ? "Camera is on. Now choose a window to share." : "Ready to record.",
    );
  } catch (error) {
    announce(`The camera could not be turned on. ${describeError(error)}`);
  }
  updateRecordButton();
}

async function chooseWindow() {
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30 } },
      audio: false,
    });
    screenPreview.srcObject = screenStream;
    await screenPreview.play();
    screenButton.textContent = "Choose another window";
    announce(cameraStream === null ? "Window chosen. Now turn on the camera." : "Ready to record.");

    // Sharing can be stopped from the browser's own controls.
    screenStream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (recordings !== null) {
        void stopRecording("Window sharing ended, so the recording stopped.");
        return;
      }
      screenStream = null;
      screenPreview.srcObject = null;
      screenButton.textContent = "Choose window";
      announce("Window sharing ended. Choose a window to share.");
      updateRecordButton();
    });
  } catch (error) {
    announce(`No window was shared. ${describeError(error)}`);
  }
  updateRecordButton();
}

function startTrackRecording(stream: MediaStream, mimeType: string): TrackRecording {
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  });

  const startedAt = new Promise<number>((resolve) => {
    recorder.addEventListener("start", (event) => resolve(event.timeStamp), { once: true });
  });
  const finished = new Promise<Blob>((resolve) => {
    recorder.addEventListener("stop", () => resolve(new Blob(chunks, { type: mimeType })), {
      once: true,
    });
  });

  // A timeslice keeps memory use flat by handing over data every second.
  recorder.start(1000);
  return { recorder, startedAt, finished };
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

  recordings = {
    cam: startTrackRecording(cameraStream, cameraMimeType),
    screen: startTrackRecording(screenStream, screenMimeType),
  };
  cameraButton.disabled = true;
  screenButton.disabled = true;
  recordButton.disabled = true;
  stopButton.disabled = false;
  stopButton.focus();
  announce("Recording. Press Stop when you are done.");

  const startedAt = performance.now();
  showElapsed(0);
  timer = window.setInterval(() => {
    const recordedMs = performance.now() - startedAt;
    showElapsed(Math.min(recordedMs, maximumTakeMs));
    if (recordedMs >= maximumTakeMs) {
      void stopRecording(
        "The take reached three minutes, the Shorts limit, so the recording stopped.",
      );
    }
  }, 250);
}

const trackNames: Record<Track, string> = { cam: "camera", screen: "screen" };

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
  if (recordings === null) {
    return;
  }
  const current = recordings;
  window.clearInterval(timer);
  disableAll();
  announce(reason);

  current.cam.recorder.stop();
  current.screen.recorder.stop();

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

    for (const stream of [cameraStream, screenStream]) {
      stream?.getTracks().forEach((track) => track.stop());
    }
    announce("Saved. You can close this tab and return to the terminal.");
  } catch (error) {
    // The camera and window stay connected, so the take can be recorded again.
    recordings = null;
    stopButton.disabled = true;
    screenButton.disabled = false;
    updateRecordButton();
    announce(`The take could not be saved. ${describeError(error)}`);
  }
}

function initialise() {
  if (token === null) {
    disableAll();
    announce(
      "Open the recorder with short record. This page needs the address that command prints.",
    );
    return;
  }
  if (cameraMimeType === null || screenMimeType === null) {
    disableAll();
    announce(
      "This browser cannot record WebM video. Open the address in Chrome or another Chromium browser.",
    );
    return;
  }

  cameraButton.addEventListener("click", () => void turnOnCamera());
  screenButton.addEventListener("click", () => void chooseWindow());
  recordButton.addEventListener("click", startRecording);
  stopButton.addEventListener("click", () => void stopRecording());
}

initialise();
