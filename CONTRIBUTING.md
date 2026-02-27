# Contributing to SF-Intel Studio

Thank you for your interest in contributing! Here's how to get started.

## Reporting Bugs

Before opening a bug report, please check existing issues to avoid duplicates.

When filing a bug, include:
- A clear, descriptive title
- Steps to reproduce the issue
- Expected vs actual behavior
- Your Chrome version and Salesforce org type (production, sandbox, scratch org)
- Any relevant console errors

## Suggesting Features

Open an issue with the `enhancement` label. Describe the problem you're trying to solve and your proposed solution.

## Submitting Pull Requests

1. Fork the repository
2. Create a feature branch from `main`:
   ```
   git checkout -b feature/your-feature-name
   ```
3. Make your changes — the extension is plain JavaScript, no build step required
4. Load the extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked) and test manually
5. Commit your changes with a clear message
6. Open a pull request against `main`

## Project Structure

```
├── manifest.json          # Extension manifest (MV3)
├── background/            # Service worker
├── content/               # Content scripts injected into Salesforce pages
├── ide/                   # Main IDE — HTML, CSS, JS modules
│   ├── lib/               # Shared utility libraries
│   ├── modules/           # Feature modules (SOQL, test runner, schema, etc.)
│   └── ide.html           # IDE entry point
├── popup/                 # Toolbar popup
├── sidepanel/             # Chrome side panel
├── dist/monaco/           # Monaco Editor (vendored)
└── icons/                 # Extension icons
```

## Code Style

- Plain vanilla JavaScript — no frameworks, no transpilation
- Keep modules focused and single-purpose
- Test against both production and sandbox Salesforce orgs where possible

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
