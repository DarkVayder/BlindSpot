import type { ComplexityEvidence } from "@blindspot/core";
import ts from "typescript";
import { extensionOf } from "./languages.js";

export interface SourceAnalysis {
  complexity: ComplexityEvidence;
  imports: string[];
}

const SCRIPT_KIND: Record<string, ts.ScriptKind> = {
  ".ts": ts.ScriptKind.TS,
  ".mts": ts.ScriptKind.TS,
  ".cts": ts.ScriptKind.TS,
  ".tsx": ts.ScriptKind.TSX,
  ".js": ts.ScriptKind.JS,
  ".mjs": ts.ScriptKind.JS,
  ".cjs": ts.ScriptKind.JS,
  ".jsx": ts.ScriptKind.JSX,
};

const LOGICAL_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

export function analyzeSource(file: string, text: string): SourceAnalysis {
  const kind = SCRIPT_KIND[extensionOf(file)] ?? ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  return {
    complexity: {
      cyclomaticMax: cyclomaticMax(sf),
      cognitiveTotal: cognitiveTotal(sf),
      codeLines: codeLines(sf),
    },
    imports: moduleSpecifiers(sf),
  };
}

function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isClassStaticBlockDeclaration(node)
  );
}

function isLogical(node: ts.Node): node is ts.BinaryExpression {
  return ts.isBinaryExpression(node) && LOGICAL_OPERATORS.has(node.operatorToken.kind);
}

function isDecisionPoint(node: ts.Node): boolean {
  switch (node.kind) {
    case ts.SyntaxKind.IfStatement:
    case ts.SyntaxKind.ConditionalExpression:
    case ts.SyntaxKind.ForStatement:
    case ts.SyntaxKind.ForInStatement:
    case ts.SyntaxKind.ForOfStatement:
    case ts.SyntaxKind.WhileStatement:
    case ts.SyntaxKind.DoStatement:
    case ts.SyntaxKind.CatchClause:
    case ts.SyntaxKind.CaseClause:
      return true;
    default:
      return isLogical(node);
  }
}

// McCabe complexity per function (1 + decision points), with module-level code treated as
// its own unit. Nested functions are measured separately and do not add to their parent.
function cyclomaticMax(sf: ts.SourceFile): number {
  let max = 1;
  const visit = (node: ts.Node, unit: { count: number }) => {
    if (isFunctionLike(node)) {
      const inner = { count: 1 };
      ts.forEachChild(node, (child) => {
        visit(child, inner);
      });
      max = Math.max(max, inner.count);
      return;
    }
    if (isDecisionPoint(node)) unit.count++;
    ts.forEachChild(node, (child) => {
      visit(child, unit);
    });
  };
  const moduleUnit = { count: 1 };
  ts.forEachChild(sf, (child) => {
    visit(child, moduleUnit);
  });
  return Math.max(max, moduleUnit.count);
}

const NESTING_STRUCTURES = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.ConditionalExpression,
]);

// Cognitive complexity after G. Ann Campbell (SonarSource, 2017), without the recursion
// increment: +1 plus the current nesting depth for each branching or looping structure,
// +1 for else / else-if, +1 per run of identical logical operators, and nesting deepens
// inside those structures and inside functions nested in other functions.
function cognitiveTotal(sf: ts.SourceFile): number {
  let total = 0;

  const visitIf = (node: ts.IfStatement, nesting: number, inFunction: boolean, elseIf: boolean) => {
    total += elseIf ? 1 : 1 + nesting;
    visit(node.expression, nesting, inFunction);
    visit(node.thenStatement, nesting + 1, inFunction);
    const otherwise = node.elseStatement;
    if (!otherwise) return;
    if (ts.isIfStatement(otherwise)) {
      visitIf(otherwise, nesting, inFunction, true);
    } else {
      total += 1;
      visit(otherwise, nesting + 1, inFunction);
    }
  };

  const visit = (node: ts.Node, nesting: number, inFunction: boolean): void => {
    if (ts.isIfStatement(node)) {
      visitIf(node, nesting, inFunction, false);
      return;
    }
    if (isFunctionLike(node)) {
      const depth = inFunction ? nesting + 1 : 0;
      ts.forEachChild(node, (child) => {
        visit(child, depth, true);
      });
      return;
    }
    if (NESTING_STRUCTURES.has(node.kind)) {
      total += 1 + nesting;
      ts.forEachChild(node, (child) => {
        visit(child, nesting + 1, inFunction);
      });
      return;
    }
    if (isLogical(node) && !isLogical(node.parent)) {
      const operands: ts.Node[] = [];
      total += logicalSequences(node, operands);
      for (const operand of operands) visit(operand, nesting, inFunction);
      return;
    }
    ts.forEachChild(node, (child) => {
      visit(child, nesting, inFunction);
    });
  };

  ts.forEachChild(sf, (child) => {
    visit(child, 0, false);
  });
  return total;
}

function logicalSequences(root: ts.BinaryExpression, operands: ts.Node[]): number {
  const operators: ts.SyntaxKind[] = [];
  const flatten = (node: ts.Expression) => {
    if (isLogical(node)) {
      flatten(node.left);
      operators.push(node.operatorToken.kind);
      flatten(node.right);
    } else {
      operands.push(node);
    }
  };
  flatten(root);
  let sequences = 0;
  operators.forEach((op, i) => {
    if (i === 0 || op !== operators[i - 1]) sequences++;
  });
  return sequences;
}

function codeLines(sf: ts.SourceFile): number {
  const lines = new Set<number>();
  const visit = (node: ts.Node) => {
    const children = node.getChildren(sf);
    if (children.length > 0) {
      for (const child of children) visit(child);
      return;
    }
    if (node.getWidth(sf) === 0) return;
    if (ts.isJsxText(node) && node.containsOnlyTriviaWhiteSpaces) return;
    const start = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    const end = sf.getLineAndCharacterOfPosition(node.getEnd()).line;
    for (let line = start; line <= end; line++) lines.add(line);
  };
  visit(sf);
  return lines.size;
}

function moduleSpecifiers(sf: ts.SourceFile): string[] {
  const found: string[] = [];
  const literal = (node: ts.Node | undefined) => {
    if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) found.push(node.text);
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      literal(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      literal(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && node.arguments.length >= 1) {
      const callee = node.expression;
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === "require" && node.arguments.length === 1;
      if (isDynamicImport || isRequire) literal(node.arguments[0]);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      literal(node.argument.literal);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}
