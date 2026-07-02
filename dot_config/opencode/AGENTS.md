## System Context

Running **Arch Linux** with [Niri](https://github.com/YaLTeR/niri) (scrollable tiling WM) and [DMS](https://github.com/ChimeraOS/dms) (Display Manager). When handling system-related tasks, use `pacman` for packages and reference Niri/DMS docs for display/window management.

## Git

Always commit your changes at the end of every turn.

## Showing HTML to the user

When you need to show the user HTML — a plan, a design mock, a report, a visualization, any rendered HTML output — **use the `html-thing` CLI** to host it and give them a clickable URL instead of dumping markup in chat.

```bash
html-thing /tmp/plan.html
# → https://html.darjs.dev/<slug>   (prints the URL, copy it into your reply)
```

- Write the HTML to a temp file (e.g. `/tmp/<name>.html`), then run `html-thing <file>`.
- Use `--name <slug>` for a memorable URL when it matters: `html-thing /tmp/plan.html --name plan-jun29`.
- The CLI is on PATH at `~/.local/bin/html-thing` (works in bash and fish). It auto-creates the R2 bucket and attaches the `html.darjs.dev` custom domain — no setup needed, just run it.
- Requires wrangler auth (already configured on this machine).
- Uploads take ~30s (wrangler is slow). Run with a long timeout or in background — don't give up at 20s.
- Prefer this over pasting raw HTML, base64 data URIs, or screenshots — the user gets a real rendered page they can inspect and share.
