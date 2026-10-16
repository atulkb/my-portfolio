import { editDistance } from '../util/text';
import { err, ok, type Result } from '../util/result';
import { RULE_VARIABLES, type RuleScope, type RuleVariable, type RuleVariableDef } from './variables';

/** Operators allowed in rules (ANALYSIS_FRAMEWORK §8). Nothing else is ever registered or accepted. */
export const RULE_OPERATORS = [
  'and',
  'or',
  '!',
  '<',
  '<=',
  '>',
  '>=',
  '==',
  '!=',
  '+',
  '-',
  '*',
  '/',
  'if',
  'in',
] as const;
/** One allowed operator (plus `var`). */
export type RuleOperator = (typeof RULE_OPERATORS)[number];

/** Structural limits (LLD §2.8). */
export const RULE_LIMITS = { maxDepth: 10, maxNodes: 100, maxStringLength: 60, maxListItems: 50 } as const;

/** Typed, validated rule expression tree. */
export type RuleExpr =
  | { readonly kind: 'var'; readonly name: RuleVariable }
  | { readonly kind: 'lit'; readonly value: number | string | boolean }
  | { readonly kind: 'list'; readonly values: readonly (number | string)[] }
  | { readonly kind: 'op'; readonly op: RuleOperator; readonly args: readonly RuleExpr[] };

/** A rule that passed validation. Only {@link validateRuleLogic} creates these. */
export type ValidRule = {
  /** The JSON-Logic AST exactly as validated (evaluated by json-logic-engine). */
  readonly json: unknown;
  readonly tree: RuleExpr;
  /** Variables referenced, in first-use order, without duplicates. */
  readonly variables: readonly RuleVariable[];
};

/** Why a rule was rejected. */
export type RuleIssueCode =
  | 'PARSE'
  | 'SHAPE'
  | 'UNKNOWN_OPERATOR'
  | 'UNKNOWN_VARIABLE'
  | 'ARITY'
  | 'TYPE'
  | 'LITERAL'
  | 'ENUM_VALUE'
  | 'TOO_DEEP'
  | 'TOO_LARGE'
  | 'NOT_BOOLEAN'
  | 'SCOPE';

/** One validation problem, with a user-readable message. */
export type RuleIssue = { readonly code: RuleIssueCode; readonly path: string; readonly message: string };

type ExprType =
  | { readonly t: 'number' }
  | { readonly t: 'boolean' }
  | { readonly t: 'string'; readonly values: readonly string[] | null; readonly label: string | null }
  | { readonly t: 'list'; readonly of: 'number' | 'string'; readonly values: readonly (number | string)[] }
  | { readonly t: 'invalid' };

const ARITY: Readonly<Record<RuleOperator, { min: number; max: number }>> = {
  and: { min: 2, max: Infinity },
  or: { min: 2, max: Infinity },
  '!': { min: 1, max: 1 },
  '<': { min: 2, max: 2 },
  '<=': { min: 2, max: 2 },
  '>': { min: 2, max: 2 },
  '>=': { min: 2, max: 2 },
  '==': { min: 2, max: 2 },
  '!=': { min: 2, max: 2 },
  '+': { min: 2, max: Infinity },
  '-': { min: 2, max: 2 },
  '*': { min: 2, max: Infinity },
  '/': { min: 2, max: 2 },
  if: { min: 3, max: 3 },
  in: { min: 2, max: 2 },
};

const isOperator = (s: string): s is RuleOperator => (RULE_OPERATORS as readonly string[]).includes(s);
const isVariable = (s: string): s is RuleVariable => Object.hasOwn(RULE_VARIABLES, s);
const INVALID: ExprType = { t: 'invalid' };

/** Closest whitelisted variable to an unknown name, by key or label. */
function suggestVariable(name: string): string | null {
  const needle = name.toLowerCase();
  let best: { key: string; label: string; d: number } | null = null;
  for (const [key, def] of Object.entries(RULE_VARIABLES)) {
    const d = Math.min(
      editDistance(needle, key.toLowerCase(), 4),
      editDistance(needle, def.label.toLowerCase(), 4),
    );
    if (d <= 4 && (best === null || d < best.d)) best = { key, label: def.label, d };
  }
  if (best === null) {
    const loose = Object.entries(RULE_VARIABLES).find(
      ([key]) => needle.startsWith(key.toLowerCase()) || key.toLowerCase().startsWith(needle),
    );
    return loose ? loose[1].label : null;
  }
  return best.label;
}

class Validator {
  readonly issues: RuleIssue[] = [];
  readonly variables: RuleVariable[] = [];
  private nodes = 0;

  private issue(code: RuleIssueCode, path: string, message: string): ExprType {
    this.issues.push({ code, path, message });
    return INVALID;
  }

  walk(node: unknown, path: string, depth: number, out: { expr: RuleExpr | null }): ExprType {
    this.nodes += 1;
    if (this.nodes > RULE_LIMITS.maxNodes) {
      if (this.nodes === RULE_LIMITS.maxNodes + 1)
        this.issue('TOO_LARGE', path, `Rule is too complex (more than ${RULE_LIMITS.maxNodes} parts).`);
      return INVALID;
    }
    if (depth > RULE_LIMITS.maxDepth)
      return this.issue(
        'TOO_DEEP',
        path,
        `Rule is nested too deeply (more than ${RULE_LIMITS.maxDepth} levels).`,
      );

    if (typeof node === 'number') {
      if (!Number.isFinite(node)) return this.issue('LITERAL', path, 'Numbers must be finite.');
      out.expr = { kind: 'lit', value: node };
      return { t: 'number' };
    }
    if (typeof node === 'string') {
      if (node.length > RULE_LIMITS.maxStringLength)
        return this.issue('LITERAL', path, 'Text values must be at most 60 characters.');
      out.expr = { kind: 'lit', value: node };
      return { t: 'string', values: null, label: null };
    }
    if (typeof node === 'boolean') {
      out.expr = { kind: 'lit', value: node };
      return { t: 'boolean' };
    }
    if (Array.isArray(node))
      return this.issue('SHAPE', path, 'Lists are only allowed as the second argument of "in".');
    if (node === null || typeof node !== 'object') return this.issue('SHAPE', path, 'Unsupported value.');

    const keys = Object.keys(node);
    if (keys.length !== 1) return this.issue('SHAPE', path, 'Each operation must have exactly one operator.');
    const op = keys[0] as string;
    const raw = (node as Record<string, unknown>)[op];

    if (op === 'var') return this.walkVar(raw, path, out);
    if (!isOperator(op)) return this.issue('UNKNOWN_OPERATOR', path, `"${op}" is not an allowed operation.`);

    const rawArgs = Array.isArray(raw) ? raw : [raw];
    const { min, max } = ARITY[op];
    if (rawArgs.length < min || rawArgs.length > max) {
      return this.issue('ARITY', path, `"${op}" needs ${min === max ? min : `at least ${min}`} argument(s).`);
    }

    const args: RuleExpr[] = [];
    const types: ExprType[] = rawArgs.map((a, i) => {
      const slot: { expr: RuleExpr | null } = { expr: null };
      const childPath = `${path}${op}[${i}]`;
      const t =
        op === 'in' && i === 1
          ? this.walkList(a, childPath, slot)
          : this.walk(a, `${childPath}.`, depth + 1, slot);
      if (slot.expr) args.push(slot.expr);
      return t;
    });
    if (types.some((t) => t.t === 'invalid')) return INVALID;
    out.expr = { kind: 'op', op, args };
    return this.typeOf(op, types, path);
  }

  private walkVar(raw: unknown, path: string, out: { expr: RuleExpr | null }): ExprType {
    const name = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
    if (typeof name !== 'string') return this.issue('SHAPE', path, '"var" must name one variable.');
    if (!isVariable(name)) {
      const hint = suggestVariable(name);
      return this.issue(
        'UNKNOWN_VARIABLE',
        path,
        `"${name}" isn't a known value${hint ? ` — did you mean ${hint}?` : '.'}`,
      );
    }
    if (!this.variables.includes(name)) this.variables.push(name);
    out.expr = { kind: 'var', name };
    const def = RULE_VARIABLES[name];
    if (def.type === 'number') return { t: 'number' };
    return { t: 'string', values: def.type === 'enum' ? def.values : null, label: def.label };
  }

  private walkList(raw: unknown, path: string, out: { expr: RuleExpr | null }): ExprType {
    this.nodes += 1;
    if (!Array.isArray(raw))
      return this.issue('SHAPE', path, '"in" needs a list of values as its second argument.');
    if (raw.length === 0 || raw.length > RULE_LIMITS.maxListItems) {
      return this.issue('LITERAL', path, `Lists must have 1–${RULE_LIMITS.maxListItems} values.`);
    }
    const allStrings = raw.every((v) => typeof v === 'string' && v.length <= RULE_LIMITS.maxStringLength);
    const allNumbers = raw.every((v) => typeof v === 'number' && Number.isFinite(v));
    if (!allStrings && !allNumbers)
      return this.issue('LITERAL', path, 'List values must be all text or all numbers.');
    const values = raw as (number | string)[];
    out.expr = { kind: 'list', values };
    return { t: 'list', of: allStrings ? 'string' : 'number', values };
  }

  private checkEnumLiteral(
    target: ExprType,
    other: ExprType,
    path: string,
    values: readonly (string | number)[],
  ): boolean {
    if (target.t !== 'string' || target.values === null) return true;
    const bad = values.filter((v) => typeof v !== 'string' || !target.values?.includes(v));
    if (bad.length > 0) {
      this.issue(
        'ENUM_VALUE',
        path,
        `${target.label ?? 'Value'} must be one of ${target.values.join(', ')}.`,
      );
      return false;
    }
    return other.t !== 'invalid';
  }

  private typeOf(op: RuleOperator, types: readonly ExprType[], path: string): ExprType {
    const all = (t: ExprType['t']): boolean => types.every((x) => x.t === t);
    switch (op) {
      case 'and':
      case 'or':
      case '!':
        return all('boolean')
          ? { t: 'boolean' }
          : this.issue('TYPE', path, `"${op}" can only combine conditions.`);
      case '<':
      case '<=':
      case '>':
      case '>=':
        return all('number') ? { t: 'boolean' } : this.issue('TYPE', path, `"${op}" compares numbers only.`);
      case '+':
      case '-':
      case '*':
      case '/':
        return all('number') ? { t: 'number' } : this.issue('TYPE', path, `"${op}" works on numbers only.`);
      case '==':
      case '!=': {
        const [a, b] = types as [ExprType, ExprType];
        if (a.t === 'number' && b.t === 'number') return { t: 'boolean' };
        if (a.t === 'boolean' && b.t === 'boolean') return { t: 'boolean' };
        // Enum literals are checked in checkEquality once the whole tree is typed.
        if (a.t === 'string' && b.t === 'string') return { t: 'boolean' };
        return this.issue('TYPE', path, `"${op}" needs both sides to be the same kind of value.`);
      }
      case 'in': {
        const [left, list] = types as [ExprType, ExprType];
        if (list.t !== 'list') return INVALID;
        if (left.t === 'number' && list.of === 'number') return { t: 'boolean' };
        if (left.t === 'string' && list.of === 'string') {
          return this.checkEnumLiteral(left, list, path, list.values) ? { t: 'boolean' } : INVALID;
        }
        return this.issue('TYPE', path, '"in" needs a value and a list of the same kind.');
      }
      case 'if': {
        const [cond, a, b] = types as [ExprType, ExprType, ExprType];
        if (cond.t !== 'boolean') return this.issue('TYPE', path, '"if" needs a condition first.');
        if (a.t !== b.t) return this.issue('TYPE', path, '"if" branches must be the same kind of value.');
        return a;
      }
    }
  }

  /** Enum check for `==`/`!=` with a literal; run after typing so both sides are known. */
  checkEquality(tree: RuleExpr): void {
    if (tree.kind !== 'op') return;
    if ((tree.op === '==' || tree.op === '!=') && tree.args.length === 2) {
      const [a, b] = tree.args as [RuleExpr, RuleExpr];
      const pair =
        a.kind === 'var' && b.kind === 'lit'
          ? ([a, b] as const)
          : b.kind === 'var' && a.kind === 'lit'
            ? ([b, a] as const)
            : null;
      if (pair) {
        const def: RuleVariableDef = RULE_VARIABLES[pair[0].name];
        if (def.type === 'enum' && !def.values.includes(String(pair[1].value))) {
          this.issue('ENUM_VALUE', tree.op, `${def.label} must be one of ${def.values.join(', ')}.`);
        }
      }
    }
    for (const arg of tree.args) this.checkEquality(arg);
  }
}

/**
 * Validates an untrusted JSON-Logic AST against the whitelist (LLD §2.8): allowed operators with
 * correct arity, whitelisted variables, type-correct operands, enum values, depth ≤ 10 and
 * nodes ≤ 100. The top level must be a condition. Nothing is ever evaluated here.
 */
export function validateRuleLogic(ast: unknown): Result<ValidRule, RuleIssue[]> {
  const v = new Validator();
  const slot: { expr: RuleExpr | null } = { expr: null };
  const type = v.walk(ast, '', 1, slot);
  if (type.t !== 'invalid' && slot.expr) v.checkEquality(slot.expr);
  if (v.issues.length === 0 && type.t !== 'boolean') {
    v.issues.push({
      code: 'NOT_BOOLEAN',
      path: '',
      message: 'A rule must be a condition that is true or false.',
    });
  }
  if (v.issues.length > 0 || !slot.expr) return err(v.issues);
  return ok({ json: ast, tree: slot.expr, variables: v.variables });
}

/** Parses the stored/compiled JSON string and validates it. */
export function parseRuleLogicJson(json: string): Result<ValidRule, RuleIssue[]> {
  let ast: unknown;
  try {
    ast = JSON.parse(json);
  } catch {
    return err([{ code: 'PARSE', path: '', message: 'The rule is not valid JSON.' }]);
  }
  return validateRuleLogic(ast);
}

/**
 * Scope check (LLD §2.8): a rule using portfolio-only values (e.g. "Your P/L %") cannot apply to
 * watchlists, and watchlist-only values (target prices) cannot apply to the portfolio.
 */
export function checkRuleScopes(
  variables: readonly RuleVariable[],
  scopes: { readonly appliesToPortfolio: boolean; readonly appliesToWatchlists: boolean },
): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const need = (scope: RuleScope, applies: boolean, name: string): void => {
    if (!applies) return;
    for (const v of variables) {
      const def = RULE_VARIABLES[v];
      if (!def.scopes.includes(scope)) {
        issues.push({
          code: 'SCOPE',
          path: v,
          message: `This rule uses ${def.label}, so it can't apply to ${name}.`,
        });
      }
    }
  };
  need('PORTFOLIO', scopes.appliesToPortfolio, 'the portfolio');
  need('WATCHLIST', scopes.appliesToWatchlists, 'watchlists');
  return issues;
}
