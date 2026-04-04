import ts from "typescript";
import fs from "fs";

const fileName = "c:/Users/Usuário/Downloads/download (12)/studio/app/ao-vivo-2/AoVivo2Content.tsx";
const sourceText = fs.readFileSync(fileName, "utf8");

const sourceFile = ts.createSourceFile(
  fileName,
  sourceText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);

function printErrors(node) {
  if (node.kind === ts.SyntaxKind.JsxExpression) {
    // just walking
  }
  ts.forEachChild(node, printErrors);
}
// Just use tsc diagnostics programmatically
const program = ts.createProgram([fileName], { jsx: ts.JsxEmit.React, noEmit: true });
const diagnostics = ts.getPreEmitDiagnostics(program);

diagnostics.forEach(diag => {
  if (diag.file) {
    const { line, character } = diag.file.getLineAndCharacterOfPosition(diag.start);
    const message = ts.flattenDiagnosticMessageText(diag.messageText, "\n");
    console.log(`${diag.file.fileName} (${line + 1},${character + 1}): ${message}`);
  }
});
