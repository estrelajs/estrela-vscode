# Estrela for vscode

Highlight syntax for Estrela files for vscode.

## Features

This extension is a language service to create Estrela element files with ".estrela" extension. it is a fork of the [Svelte Language Service extension](https://github.com/sveltejs/language-tools.git).

Estrela file example:

![app-root element](https://github.com/estrelajs/estrela-vscode/raw/main/assets/syntax-highlight.png)

VSCode outline tree:

![app-root element](https://github.com/estrelajs/estrela-vscode/raw/main/assets/outline.png)

## Requirements

Estrela files do not use real Jsx elements, it only translates Jsx to `html` string calls. For that reason, if typescript is in strict mode, it will complaign about "JSX element implicitly has type 'any' because no interface 'JSX.IntrinsicElements'". To solve that, disable "noImplicitAny" in `tsconfig.json`.

## To do

- Add custom implementations of Jsx elements.
- Add reference to the element `host`.
- Fix import indentation.

## Release Notes

### 1.1.0

Updated on|bind and class|style syntax.

### 1.0.3

Minor bug fixes.

### 1.0.2

Fixed import bug.

### 1.0.1

Fixed typescript types bug.

### 1.0.0

Initial release of Estrela extension.
