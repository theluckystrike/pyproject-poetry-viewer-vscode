# PyProject & Ruff Config View for VS Code

Inspect `pyproject.toml`, `ruff.toml` and `.ruff.toml` files in VS Code without running Python, pip, Poetry, uv or calling any cloud service. Large Python project configs often hide unpinned `*` or git-branch dependencies, a missing `requires-python` range, disabled Ruff security `S` rules, `disallow_untyped_defs = false` in Mypy, or plaintext index credentials. This extension parses TOML project and linter configs locally in plain JavaScript with zero Python execution or network calls.

![PyProject & Ruff Config View showing dependencies, optional groups, Ruff, Mypy and Pytest settings, build-system entrypoints and static findings](images/screenshot.png)

## What it opens

- `pyproject.toml` files (PEP 621 `[project]`, `[tool.poetry]`, `[tool.uv]`, `[build-system]`, `[tool.ruff]`, `[tool.mypy]` and `[tool.pytest]`).
- Standalone `ruff.toml` and `.ruff.toml` files.
- Any matching file via the Command Palette or Explorer context menu (Open in PyProject & Ruff Config View).
- Nothing to install, no Python, pip or uv process started, no cloud or network calls.

## The free part

- Dependency and optional-group explorer: lists `[project.dependencies]`, `[project.optional-dependencies]`, `[tool.poetry.dependencies]`, `[tool.poetry.group.*]` and `[tool.uv]` dependency groups with line numbers and specifiers.
- Tool config table: displays `[tool.ruff]`, `[tool.mypy]` and `[tool.pytest]` settings side by side in one searchable table.
- Build-system and script entrypoint map: shows `build-backend`, `requires`, `[project.scripts]`, `[project.gui-scripts]`, `[project.entry-points]` and `[tool.poetry.scripts]`.
- Static findings: flags unpinned `*` or git-branch dependencies, missing `requires-python`, disabled Ruff security `S` rules, `disallow_untyped_defs = false` in Mypy, and plaintext credentials in package index URLs.

## The Pro tools, with 1 free try

Pro adds the audit, diff and export steps: generate a Markdown dependency-pinning, Ruff and typing audit for one config or a folder, compare two `pyproject.toml` or `ruff.toml` files in Markdown, or export Markdown and CSV dependency and tool-config inventory locally. Your first try of each Pro tool is free. Zovo Pro is USD 19 once, and the team licence is USD 59.

## Why not plain text

Reading a 400-line `pyproject.toml` in plain text makes it easy to miss an unpinned git dependency, a disabled Ruff `S` rule, relaxed Mypy typing or credentials embedded in a private index URL. A local inspector puts dependencies, tool settings, entrypoints and findings on one screen.

## More tools by Zovo

See full docs and install options at [vscode.zovo.one/extensions/zovo-pyproject-poetry-viewer/](https://vscode.zovo.one/extensions/zovo-pyproject-poetry-viewer/), browse all Zovo VS Code extensions at [vscode.zovo.one](https://vscode.zovo.one/), or explore [Zovo Pro](https://vscode.zovo.one/pro/).
