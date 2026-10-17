# shorty-pants

A local-first tool that turns a moment of discovery while coding into a finished YouTube Short. It records your camera and one shared window, transcribes locally, lets you cut by editing the transcript, and renders a 1080 × 1920 video with word-timed captions.

This project is in early development. Run `short --help` to see the planned commands; each one arrives with its milestone.

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

## Development

The project uses [Vite+](https://viteplus.dev/) with pnpm and requires Node 24.11 or newer.

```bash
pnpm install
pnpm test
pnpm quality
```

`pnpm quality` runs formatting, linting and type checks through `vp check`, the unit tests, Stylelint, html-validate and Knip.

## License

MIT
