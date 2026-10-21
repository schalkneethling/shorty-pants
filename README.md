# shorty-pants

A local-first tool that turns a moment of discovery while coding into a finished YouTube Short. It records your camera and one shared window, transcribes locally, lets you cut by editing the transcript, and renders a 1080 × 1920 video with word-timed captions.

## Installing

shorty-pants needs Node 24.11 or newer and runs on macOS first.

```bash
npm install --global @schalkneethling/shorty-pants
short --help
```

Transcription and rendering also need the tools described below: whisper.cpp with a model, FFmpeg, and Chrome or Chromium.

## Recording

`short record [title]` creates a folder for the short, serves the recorder on 127.0.0.1 and opens it in your browser. Turn on the camera, choose the window to share, and press Start recording. The camera and the window are saved as two separate tracks. Press Stop, or let the three-minute limit stop the take, and the take is saved.

While you record, the page shows the camera and the window in the 1080 × 1920 frame that the short will have, placed with the same code as the editor and the render. The preview layout starts as the default layout in `preset.json`, which is read when the command starts, so a preset that is not valid stops `short record` before it creates a folder. Without a preset, the defaults apply.

- **Preview layout** switches between split, face and circle cam at any time, even during a take. It changes only the preview. It is not saved, and you still choose a layout for each part of the short in the editor. The recording itself never changes: the camera and the window are recorded as they are.
- **View size** sets how large the frame is drawn. Fit shows the whole frame in the window. Phone size draws it 430 pixels wide, close to a phone held upright. Actual pixels draws it 1080 pixels wide, one pixel of the short for each pixel on your screen, in an area that scrolls and can be reached with the keyboard.
- **Guides** show the safe zones from the preset, and the areas where the headline and the captions will go. Both are on by default, and each has a checkbox to hide it. The Desktop safe zones switch shows what the desktop Shorts player covers instead of the phone player, which covers more. The headline and the captions always keep clear of the phone player, whichever guides are shown.

Below the controls, a sentence says how the window fits the layout. For example, in split, each recorded pixel of the window may become 0.98 pixels of the short, and the short may show the middle 58% of the window's width and all of its height. A window that is wider than the layout is cut at its sides, so text near the edges of a wide window may not appear in the short. The preview shows the whole window, without a crop, as the editor and the render do until you choose a crop in the editor.

The readout has limits. The tool knows the size of the recording in pixels and the scale exactly. It does not know the pixel density of the window you shared: a Retina display is likely, but not confirmed, to be captured in physical pixels, so the scale counts physical pixels rather than the points you see on your screen. It also does not know which phone the viewer holds, how much YouTube compresses the video, or the crop you choose later, and a crop can only make the window larger in the short. Phone size is an approximation of physical size, not a measurement.

## Transcription

Takes are transcribed locally with [whisper.cpp](https://github.com/ggml-org/whisper.cpp), which needs ffmpeg and a model file. On macOS, both tools come from Homebrew, and the Homebrew build of whisper.cpp uses Metal on Apple silicon.

```bash
brew install ffmpeg whisper-cpp
curl --fail --create-dirs -L -o ~/.cache/shorty-pants/models/ggml-small.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin
```

`short record` transcribes each take as soon as it is saved, and `short transcribe <short folder>` transcribes one again. The words and their times are written to `transcript.json` in the short folder. Once a short has edits in `short.json`, which refer to words by their position, `short transcribe` only replaces the transcript with `--force`.

The model is `~/.cache/shorty-pants/models/ggml-small.en.bin` unless `--model` or `SHORTY_PANTS_WHISPER_MODEL` names another one. `SHORTY_PANTS_WHISPER_BIN` sets the whisper-cli binary, and `--language` or `SHORTY_PANTS_WHISPER_LANGUAGE` sets the spoken language, which is English by default.

## Editing

`short edit <short folder>` opens the editor in your browser. The transcript is shown as words: select words and press Delete to cut them, and press Delete again to bring them back. The trim handles set where the short starts and ends, and pauses longer than the threshold in the preset are cut on their own. The preview plays the short with every cut applied, and each change is saved to `short.json` as you go. Press Done in the editor, or Ctrl+C in the terminal, when you are finished. Pass `--no-open` to print the editor address without opening a browser.

The editor also dresses the short. Select words and choose a layout for them: split puts the shared window above the camera, face shows only the camera, and circle cam puts the camera in a circle over the window. Type a headline and pick its accent word, and crop the shared window if only part of it matters. The preview shows the captions as they will appear, a few words at a time with the current word lit, and Show safe zones dims the parts of the frame that YouTube's own buttons and text cover, on a phone or, with the Desktop safe zones switch on, on desktop.

The caption style, the default layout, the pause threshold and the safe zones come from `preset.json` in the shorts root. `safeZones` sets what the phone player covers, which the layout keeps clear of, and `desktopSafeZones` sets what the desktop guides show. Without one, the defaults are Noto Sans in white on dark purple, with yellow for the accent.

## Rendering

`short render <short folder>` turns the edits into three files in the short's `out` folder: `short.mp4`, a 1080 × 1920 video at 30 frames per second; `captions.vtt`, to upload in YouTube Studio as the caption track next to the captions drawn into the video; and `upload.txt`, with the headline as a suggested title and the spoken words as a suggested description. The short needs a headline, which `short edit` adds, and can be up to three minutes long.

The headline and captions are drawn by a browser with the same CSS as the editor preview, then placed into the video by FFmpeg, which also brings the sound to the loudness YouTube plays at. The browser is Playwright's Chromium when it is installed, otherwise Google Chrome; `short render` names the exact command that installs the Chromium it looks for, and `SHORTY_PANTS_CHROMIUM` names another Chromium binary.

## Development

The project uses [Vite+](https://viteplus.dev/) with pnpm and requires Node 24.11 or newer.

```bash
pnpm install
pnpm test
pnpm quality
```

`pnpm quality` runs formatting, linting and type checks through `vp check`, the unit tests, Stylelint, html-validate and Knip.

Releases are published to npm from GitHub Actions with trusted publishing; [docs/releasing.md](docs/releasing.md) describes the steps.

## License

MIT
