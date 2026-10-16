import type { RuleExpr, ValidRule } from './validate';
import { RULE_VARIABLES } from './variables';

const COMPARE: Readonly<Record<string, string>> = {
  '<': 'is below',
  '<=': 'is at most',
  '>': 'is above',
  '>=': 'is at least',
  '==': 'is',
  '!=': 'is not',
};
const ARITH: Readonly<Record<string, string>> = { '+': '+', '-': '−', '*': '×', '/': '÷' };
const ENUM_TEXT: Readonly<Record<string, string>> = {
  GOOD: 'Good',
  AVERAGE: 'Average',
  BAD: 'Bad',
  IN: 'India',
  US: 'US',
};

function literal(value: number | string | boolean): string {
  if (typeof value === 'string') return ENUM_TEXT[value] ?? value;
  return String(value);
}

type Op = Extract<RuleExpr, { kind: 'op' }>;
const isOp = (e: RuleExpr | undefined, op?: string): e is Op =>
  e?.kind === 'op' && (op === undefined || e.op === op);

/** Recognises `xPrev <= yPrev AND x > y` (crossed above) and `xPrev >= yPrev AND x < y` (crossed below). */
function crossing(a: RuleExpr, b: RuleExpr): string | null {
  if (!isOp(a) || !isOp(b)) return null;
  const dir = a.op === '<=' && b.op === '>' ? 'above' : a.op === '>=' && b.op === '<' ? 'below' : null;
  if (dir === null) return null;
  const [ap, bp] = a.args as [RuleExpr, RuleExpr];
  const [ac, bc] = b.args as [RuleExpr, RuleExpr];
  if (ap.kind !== 'var' || ac.kind !== 'var' || ap.name !== `${ac.name}Prev`) return null;
  const sameRight =
    (bp.kind === 'var' && bc.kind === 'var' && bp.name === `${bc.name}Prev`) ||
    (bp.kind === 'lit' && bc.kind === 'lit' && bp.value === bc.value);
  if (!sameRight) return null;
  return `${render(ac, 'top')} crossed ${dir} ${render(bc, 'top')}`;
}

type Ctx = 'top' | 'and' | 'or' | 'arith';

function render(e: RuleExpr, ctx: Ctx): string {
  switch (e.kind) {
    case 'var':
      return RULE_VARIABLES[e.name].label;
    case 'lit':
      return literal(e.value);
    case 'list':
      return e.values.map(literal).join(', ');
    case 'op':
      return renderOp(e, ctx);
  }
}

function renderAnd(args: readonly RuleExpr[]): string[] {
  const used = new Set<number>();
  const parts: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (used.has(i)) continue;
    let phrase: string | null = null;
    for (let j = 0; j < args.length && phrase === null; j++) {
      if (i === j || used.has(j)) continue;
      phrase = crossing(args[i] as RuleExpr, args[j] as RuleExpr);
      if (phrase !== null) used.add(j);
    }
    used.add(i);
    parts.push(phrase ?? render(args[i] as RuleExpr, 'and'));
  }
  return parts;
}

function renderOp(e: Op, ctx: Ctx): string {
  const [a, b, c] = e.args;
  switch (e.op) {
    case 'and': {
      const text = renderAnd(e.args).join(' AND ');
      return ctx === 'or' ? `(${text})` : text;
    }
    case 'or': {
      const text = e.args.map((x) => render(x, 'or')).join(' OR ');
      return ctx === 'and' ? `(${text})` : text;
    }
    case '!':
      return `NOT (${render(a as RuleExpr, 'top')})`;
    case 'in':
      return `${render(a as RuleExpr, 'top')} is one of ${render(b as RuleExpr, 'top')}`;
    case 'if':
      return `(if ${render(a as RuleExpr, 'top')} then ${render(b as RuleExpr, 'top')}, otherwise ${render(c as RuleExpr, 'top')})`;
    case '+':
    case '-':
    case '*':
    case '/': {
      const text = e.args.map((x) => render(x, 'arith')).join(` ${ARITH[e.op]} `);
      return ctx === 'arith' ? `(${text})` : text;
    }
    default:
      return `${render(a as RuleExpr, 'top')} ${COMPARE[e.op]} ${render(b as RuleExpr, 'top')}`;
  }
}

/**
 * Deterministic plain-English read-back of a validated rule (LLD §2.8). The user confirms this
 * text — not the model's prose — so what they approve is exactly what runs.
 */
export function renderReadBack(rule: ValidRule): string {
  return render(rule.tree, 'top');
}
