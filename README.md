# superFinn Desktop

A thin desktop shell around the superFinn PWA, built with Tauri v2. It opens two windows onto the same message stream the superFinn server already serves, adds a tray icon, and gets out of the way. Pages, messages and approvals all live in the superFinn server, which is not in this repository.

## What it does

- **Main window**: a connect page, then the full PWA. Type the server address (for example `http://127.0.0.1:7777`) and the pairing token, or paste the whole output of `superfinn pwa-url` and both fields fill in. After connecting, the window loads the server's own `/pair` link and then the PWA.
- **Companion window**: a small frameless window that stays on top, loads the PWA's `/?view=mini` (status line, the latest three messages, the input box) and adds a 30 px bar with four controls:
  - drag the bar to move the window (its position is restored next time, if that screen is still attached);
  - `顶` toggles always-on-top;
  - `-` folds the window into a single status line (`+` or a double-click unfolds it); while folded, the line reads `需要你 N · …` when something is waiting for you;
  - `×` hides it into the tray.
  Drop files onto it and they are uploaded to the same server and sent as one "看看这个" message.
- **Tray icon** with three states, drawn in the PWA's own lamp style: hollow square = idle (`空闲`), filled = working (`在做`), filled with an outer ring = waiting for you (`等你`), plus a dashed square when the server is unreachable. The state is read from what the PWA itself renders; the shell keeps no copy of the stream. The tray menu shows or hides the companion window, opens the main window, opens the connection settings, or quits.
- **Offline**: if the server stops answering for more than three seconds, both windows show `没连上 superFinn` with a retry button. Retry goes back to the shell page, checks the port, and pairs again; the companion window also retries on its own every ten seconds. If the server replies that the pairing token has changed, the window says so and points to the connection settings.
- **Avatar**: the default companion visual is the status symbol above. A 2D avatar option is shown on the connect page but disabled; nothing is wired to it yet.

Closing a window hides it into the tray. Quit from the tray menu.

## Where things are stored

- The pairing token goes into the operating system's credential store only (Windows Credential Manager, macOS Keychain, Linux kernel keyutils) through the Rust side. The shell's page scripts never read it back; the Rust side builds the `/pair` link and navigates the window.
- The server address and two UI preferences (folded, pinned) live in the webview's local storage. The companion window's last position lives in the app config directory. Nothing else is written.
- Versions that stored the whole pairing link in local storage are migrated on first start: the token is moved into the credential store and the old entry is deleted.

## Permissions

The shell's own commands are declared in `src-tauri/build.rs` and granted through two capability files:

- `capabilities/default.json`: pages bundled with the shell (the connect page and the companion's connecting page) get every shell command, including saving and clearing the token.
- `capabilities/remote.json`: PWA pages served from `http://127.0.0.1:*` or `http://localhost:*` get only drag, fold, pin, hide, tray state and "go back to the shell page". They cannot touch the token and get no `core:` permissions. A server on any other address still loads, but the companion bar, tray state and offline retry will not work there.

The script that adds the companion bar, the tray state and the offline cover to PWA pages is `src/inject/pwa-shell.js`; the Rust side injects it into both windows. It only acts on the server's pages and uses the PWA's own design tokens for colors.

## Build

Prerequisites: Node 22, Rust stable, and the Tauri v2 platform prerequisites for your OS.

```sh
npm ci
npm test               # shell unit tests (node --test, no extra dependencies)
npm run tauri dev      # run locally
npm run tauri build    # produce an installer for the current OS
```

GitHub Actions runs `cargo check` on every push and builds Windows and macOS (Apple silicon and Intel) installers on every `v*` tag or manual run, attached to a draft release. Builds are unsigned: on macOS run `xattr -d com.apple.quarantine <app>` once, on Windows accept the SmartScreen prompt.

## Repository rules

This repository is public. It must never contain internal hostnames, IP addresses other than loopback, tokens, pairing links, or anything that describes the private superFinn server. The shell only knows the address you type into it at runtime.

Before pushing, enable the scan hook once with `git config core.hooksPath .githooks`; it runs `bash scripts/secret-scan.sh --all` on every `git push` and blocks the push on any hit (use `--staged` before a commit).

## License

MIT
