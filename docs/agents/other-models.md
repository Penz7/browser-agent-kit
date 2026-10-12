# DeepSeek, Qwen, GLM, Llama, Mistral and other models

These are models, not agents: they need an MCP-capable client. Pick one, point it at the model, and configure the kit in that client.

| Client | Models | Guide |
|---|---|---|
| Cline (VS Code) | any API: DeepSeek, Qwen, GLM, OpenRouter, Ollama, LM Studio | [cline.md](cline.md) |
| Roo Code (VS Code) | same | [roo-code.md](roo-code.md) |
| OpenCode (terminal) | any provider incl. local | [opencode.md](opencode.md) |
| Kiro | its own models | [kiro.md](kiro.md) |

## Settings that help smaller models

Put these in the `env` of the MCP config:

| Variable | Why |
|---|---|
| `BROWSER_KIT_AUTO_SCREENSHOT=0` | no image after every action; the model calls `screenshot` only when it needs pixels. Big token saving for text-first models |
| `BROWSER_KIT_MAX_WIDTH=800` | smaller images when it does take one |

And tell the model, via the client's rules file:

- Prefer `read_page` with filter `interactive` and `find`; click by `ref`, not by coordinates.
- Use `form_input` for forms, `browser_batch` for known sequences.
- Re-run `read_page` after any navigation; refs reset.

Expect more wrong turns than with Claude: vision quality and tool discipline differ by model. Ref-based clicking is what keeps weaker models on track.
