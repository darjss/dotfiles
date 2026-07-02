set -g fish_greeting

if status is-interactive
    # Start gnome-keyring for Codex CLI auth
    gnome-keyring-daemon --start --components=secrets 2>/dev/null | while read -l line
        set -l parts (string split "=" -- $line)
        set -gx $parts[1] $parts[2]
    end

# Commands to run in interactive sessions can go here
    if command -v zoxide >/dev/null 2>&1
        zoxide init fish | source
    end
    
    # Custom aliases
    alias zd='zeditor .'
    alias c='cursor .'
    alias o='opencode'
    alias cc='CLAUDE_CODE_NO_FLICKER=1 claude --dangerously-skip-permissions'
    
    # Project creation from templates (cr- prefix = "create")
    function cr-app
        gh repo create $argv[1] --template haltuurgang/app-starter- --private --clone
    end
    function cr-mono
        gh repo create $argv[1] --template darjss/mono-starter --private --clone
    end
    function cr-be
        gh repo create $argv[1] --template haltuurgang/backend-starter --private --clone
    end
    function cr-astro
        gh repo create $argv[1] --template darjss/astro-starter --private --clone
    end
    function cr-saas
        gh repo create $argv[1] --template darjss/saas-starter --private --clone
    end
    
    # Bun run deploy
    alias brd='bun run deploy'
    
    # Git push with commit - takes optional message, defaults to "upd"
    function gp
        set -l message "upd"
        if test (count $argv) -gt 0
            set message "$argv"
        end
        git add .
        git commit -m "$message"
        git push
    end
end

# bun
set --export BUN_INSTALL "$HOME/.bun"
set --export PATH $BUN_INSTALL/bin $PATH
set --export PATH "$HOME/.local/bin" $PATH
set --export PATH "$HOME/.cargo/bin" $PATH
set -gx CHROME_PATH "/opt/helium-browser-bin/helium"
set -gx FIREFOX_PATH "/usr/bin/zen-browser"

# agent-browser: attach to the user's real Helium session via CDP.
# Helium launches with --remote-debugging-port=9222 (see helium-browser-flags.conf).
# agent-browser auto-connects to it — no separate browser launched, no temp profile.
set -gx AGENT_BROWSER_EXECUTABLE_PATH /usr/bin/helium-browser
set -gx AGENT_BROWSER_AUTO_CONNECT 1

# devin — auto-approve all tools, no permission prompts
set -gx DEVIN_PERMISSION_MODE dangerous
abbr -a d devin

# pnpm
set -gx PNPM_HOME "/home/darjs/.local/share/pnpm"
if not string match -q -- $PNPM_HOME $PATH
  set -gx PATH "$PNPM_HOME" $PATH
end
# pnpm end

# >>> grok installer >>>
fish_add_path $HOME/.grok/bin
# <<< grok installer <<<
