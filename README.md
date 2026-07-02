# darjss dotfiles

Managed with [chezmoi](https://chezmoi.io) + [age](https://github.com/FiloSottile/age) encryption.

## New machine setup

```bash
# 1. Install chezmoi + age
paru -S chezmoi age

# 2. Restore age key (from password manager / USB / wherever)
mkdir -p ~/.config/age
# copy your age key to ~/.config/age/key.txt
chmod 600 ~/.config/age/key.txt

# 3. Init from this repo
chezmoi init darjss/dotfiles

# 4. Install all packages (optional — run if fresh install)
chezmoi run

# 5. Apply configs
chezmoi apply
```

## What's included

- **Shell**: fish (config, completions, functions, aliases)
- **Terminal**: ghostty (config + themes)
- **WM**: niri + DankMaterialShell (config, keybinds, themes, CSS)
- **Editors**: zed, cursor, devin, vscodium (settings + keybindings)
- **AI agents**: opencode, claude desktop, codex (configs + encrypted secrets)
- **Media**: mpd, mpv, rmpc
- **System**: fontconfig (Onest + FiraCode Nerd Font), gtk, swaylock, matugen
- **Tools**: lazygit, gh, zoxide, helium browser flags

## Encrypted secrets

These files are encrypted with age and safe to commit:
- `.config/opencode/config.json` (MCP keys)
- `.config/Claude/claude_desktop_config.json` (Google OAuth)
- `.config/cursor/auth.json`
- `.config/google-workspace-mcp/tokens.json`
- `.config/mcp-google-search-console/*.json`

## Updating

```bash
chezmoi update       # pull + apply
chezmoi edit <file>  # edit a managed file
chezmoi add <file>   # add a new file to management
chezmoi apply        # apply changes
```
