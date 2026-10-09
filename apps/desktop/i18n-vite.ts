import ts from "typescript";
import path from "node:path";
import type { Plugin } from "vite";

/**
 * Only human-facing static JSX copy is marked automatically. Never rewrite
 * arbitrary literals: provider IDs, status enums, URLs and payment values
 * are semantic data, not translations.
 */
export function localizedJsxPlugin(): Plugin {
  return {
    name: "tixbam-localized-jsx",
    enforce: "pre",
    transform(source, id) {
      const filename = id.split("?")[0];
      if (!filename.endsWith(".tsx") || !filename.includes("/apps/desktop/src/")) return;
      if (filename.includes("/src/i18n/")) return;
      const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      let rewritten = 0;
      const jsxProps = new Set(["placeholder", "title", "aria-label", "alt"]);
      const translateCall = (text: string) =>
        ts.factory.createCallExpression(ts.factory.createIdentifier("__tixbamTx"), undefined,
          [ts.factory.createStringLiteral(text)]);
      const transformer: ts.TransformerFactory<ts.SourceFile> = ctx => {
        const visit = (node: ts.Node): ts.Node => {
          if (ts.isJsxText(node)) {
            const raw = node.text;
            const trimmed = raw.trim();
            if (!trimmed || !/[A-Za-z]/.test(trimmed)) return node;
            rewritten++;
            // Inline adjacent text needs its original separation preserved.
            const before = /^\s/.test(raw) && !/^\s*\n/.test(raw) ? " " : "";
            const after = /\s$/.test(raw) && !/\n\s*$/.test(raw) ? " " : "";
            return ts.factory.createJsxExpression(undefined, translateCall(before + trimmed + after));
          }
          if (ts.isJsxAttribute(node) && jsxProps.has(node.name.text) &&
              node.initializer && ts.isStringLiteral(node.initializer) &&
              /[A-Za-z]/.test(node.initializer.text) &&
              !/^https?:\/\//.test(node.initializer.text)) {
            rewritten++;
            return ts.factory.updateJsxAttribute(node, node.name,
              ts.factory.createJsxExpression(undefined, translateCall(node.initializer.text)));
          }
          return ts.visitEachChild(node, visit, ctx);
        };
        return node => ts.visitNode(node, visit) as ts.SourceFile;
      };
      const output = ts.transform(file, [transformer]).transformed[0];
      if (!rewritten) return;
      const translator = path.relative(path.dirname(filename), path.join(
        filename.split("/apps/desktop/src/")[0], "apps/desktop/src/i18n/index")).replaceAll(path.sep,"/");
      const importPath = translator.startsWith(".") ? translator : "./" + translator;
      const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
      const out = printer.printFile(output);
      return { code: 'import { tx as __tixbamTx } from ' + JSON.stringify(importPath) + ';\n' + out, map: null };
    }
  };
}
