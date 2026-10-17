# shorty-pants

A local-first tool that turns a moment of discovery while coding into a finished YouTube Short. It records your camera and one shared window, transcribes locally, lets you cut by editing the transcript, and renders a 1080 × 1920 video with word-timed captions.

This project is in early development. Run `short --help` to see the planned commands; each one arrives with its milestone.

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
