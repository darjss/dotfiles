# Generic herdr/orch worker aliases.
# The current shell/session remains the god/orchestrator; these select the CLI used for spawned workers.
# `orch` maps the short names to real unattended invocations (cc -> claude bypass, codex -> codex bypass),
# so `cc` can never resolve to the C compiler. Default worker when none is chosen is `cc` (Claude Code).
alias orch-pi='env ORCH_AGENT_CMD=pi orch'
alias orch-cc='env ORCH_AGENT_CMD=cc orch'
alias orch-codex='env ORCH_AGENT_CMD=codex orch'
alias orch-opencode='env ORCH_AGENT_CMD=opencode orch'
