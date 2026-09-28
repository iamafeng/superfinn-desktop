# superFinn Desktop

A thin desktop window around the superFinn workbench PWA, built with Tauri v2. It does three things: open the pair link you give it, remember it, and get out of the way. Everything else lives in the superFinn server, which is not in this repository.

## Build

Prerequisites: Node 22, Rust stable, and the Tauri v2 platform prerequisites for your OS.

```sh
npm ci
npm run tauri dev      # run locally
npm run tauri build    # produce an installer for the current OS
```

GitHub Actions builds Windows and macOS (Apple silicon and Intel) installers on every `v*` tag and attaches them to a draft release. Builds are unsigned: on macOS run `xattr -d com.apple.quarantine <app>` once, on Windows accept the SmartScreen prompt.

## Repository rules

This repository is public. It must never contain internal hostnames, IP addresses, tokens, pairing links, or anything that describes the private superFinn server. The shell only knows the URL you type into it at runtime, stored in the webview's local storage.

## License

MIT
