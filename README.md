# Estrela for vscode

Highlight syntax for Estrela files for vscode.

## Features

This extension is a language service to create Estrela element files with ".estrela" extension. it is a fork of the [Svelte Language Service extension](https://github.com/sveltejs/language-tools.git).

Estrela file example:

![app-root element](https://github.com/estrelajs/estrela-vscode/raw/main/assets/syntax-highlight.png)

VSCode outline tree:

![app-root element](https://github.com/estrelajs/estrela-vscode/raw/main/assets/outline.png)

## Requirements

Estrela files do not use real Jsx elements, it only translates Jsx to `html` string calls. For that reason, vscode will complaign about "JSX element implicitly has type 'any' because no interface 'JSX.IntrinsicElements'".

To fix it you need to add React types:

```bash
# npm
npm i -save -D @types/react

# yarn
yarn add --dev @types/react
```

<!-- ## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

* `myExtension.enable`: enable/disable this extension
* `myExtension.thing`: set to `blah` to do something -->

## To do

- Add custom implementations of Jsx elements or bundle "@types/react" in the extension package.

## Release Notes

### 1.0.0

Initial release of Estrela extension.
