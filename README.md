# Future Flow AI — Claude Code plugins

Claude Code plugins, skills and mods by Future Flow AI, published as one marketplace (`futureflowai-mods`). Install only what you need; each plugin stands on its own.

| Plugin | Type | What it does |
| --- | --- | --- |
| [voice-chat](voice-chat/) | mod | Talk to your Claude Code session through a fast Inworld voice agent. It handles small talk itself, hands real tasks to Claude Code and tells you the outcome (`/voice`). |
| [futureflow-skills](futureflow-skills/) | skills | Future Flow AI's own working methods, picked up by Claude Code automatically. |
| [content-skills](content-skills/) | skills | 54 content and social media skills (reels, hooks, carousels, captions, planning), based on [Ootto's claude-content-skills](https://github.com/Ootto-AI/claude-content-skills). |

## Install

```bash
claude plugin marketplace add colin-futureflowai/FutureFlowAI_mods
claude plugin install voice-chat@futureflowai-mods
claude plugin install futureflow-skills@futureflowai-mods
claude plugin install content-skills@futureflowai-mods
```

After an update, run `claude plugin marketplace update futureflowai-mods` and `/reload-plugins` in your session.

### voice-chat

Requirements: macOS, `node` and `ffmpeg` (`brew install ffmpeg`), and your own [Inworld](https://inworld.ai) API key. Usage of Inworld is billed to your own account.

During installation Claude Code asks for the plugin settings. The Inworld API key is stored in the system keychain, not in a file; the other settings (language, voice, microphone, agent model) can be changed later via `/config`. The interface and the voice agent speak Dutch by default; set `language` to change the speech language.

What the voice agent passes on is spoken input summarised by an external model, so Claude Code treats it as a suggestion rather than a typed command and asks for confirmation before irreversible or outward-facing actions.

For development you can also use `voice-chat/.env` (`cp voice-chat/.env.example voice-chat/.env`); a value from the plugin settings always takes precedence.

### content-skills

If you also have Ootto's original plugin (`claude-content-skills`) installed, uninstall it: the skills share the same names and would otherwise load twice.

## License

[MIT](LICENSE). `content-skills` contains work by Ootto and Panniantong, also under MIT; see [content-skills/LICENSE](content-skills/LICENSE).
