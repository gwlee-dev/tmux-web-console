# tmux-web-console

Web UI for controlling tmux sessions, windows, and panes.

## Goal

Build a browser-based control surface for tmux that lets you:

- list and switch sessions
- inspect windows and panes
- send commands to panes
- create/kill/rename sessions and windows
- monitor live status from the web

## Initial scope ideas

- backend bridge to tmux via `tmux list-sessions`, `list-windows`, `list-panes`, `send-keys`
- web dashboard for session/window/pane navigation
- safe command execution model
- optional auth layer if exposed beyond localhost

