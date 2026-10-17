import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { runCommand } from "../../src/commands.ts";
import { parseTranscript } from "../../src/schemas/transcript.ts";
import { transcribeShort } from "../../src/transcribe/transcribe.ts";

// Runs the real ffmpeg and whisper-cli, to catch changes in whisper's output
// format. It needs a model and an audio file with speech, so it only runs
// when both are given:
//   SHORTY_PANTS_WHISPER_MODEL=~/.cache/shorty-pants/models/ggml-small.en.bin \
//   SHORTY_PANTS_WHISPER_TEST_AUDIO=path/to/speech.wav pnpm test
const modelPath = process.env.SHORTY_PANTS_WHISPER_MODEL;
const audioPath = process.env.SHORTY_PANTS_WHISPER_TEST_AUDIO;
const isConfigured = modelPath !== undefined && audioPath !== undefined;

test.runIf(isConfigured)(
  "transcribes real speech with the installed whisper-cli",
  async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "shorty-pants-whisper-")));
    try {
      mkdirSync(join(workspace, "takes"));
      // ffmpeg reads the format from the content, so any audio file works as the camera track.
      copyFileSync(audioPath!, join(workspace, "takes", "cam.webm"));
      writeFileSync(
        join(workspace, "takes.json"),
        JSON.stringify({
          version: 1,
          recordedAt: new Date().toISOString(),
          takes: { cam: "takes/cam.webm", screen: "takes/screen.webm", screenOffsetMs: 0 },
        }),
      );

      const transcript = await transcribeShort({
        shortFolder: workspace,
        modelPath: modelPath!,
        whisperBinary: process.env.SHORTY_PANTS_WHISPER_BIN ?? "whisper-cli",
        language: "en",
        run: runCommand,
      });

      expect(parseTranscript(transcript).success).toBe(true);
      expect(transcript.durationMs).toBeGreaterThan(0);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  },
  120_000,
);
