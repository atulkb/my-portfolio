import { RULE_VARIABLE_NAMES, RULE_VARIABLES, RuleVariableSchema } from './variables';

describe('RULE_VARIABLES', () => {
  it('covers every variable in ANALYSIS_FRAMEWORK §8', () => {
    expect(RULE_VARIABLE_NAMES).toHaveLength(40);
    expect(RuleVariableSchema.safeParse('rsi14').success).toBe(true);
    expect(RuleVariableSchema.safeParse('constructor').success).toBe(false);
  });

  it('scopes position variables correctly', () => {
    expect(RULE_VARIABLES.pnlPct.scopes).toEqual(['PORTFOLIO']);
    expect(RULE_VARIABLES.performanceLabel.scopes).toEqual(['PORTFOLIO']);
    expect(RULE_VARIABLES.targetEntryPrice.scopes).toEqual(['WATCHLIST']);
    expect(RULE_VARIABLES.close.scopes).toEqual(['PORTFOLIO', 'WATCHLIST']);
  });

  it('gives enum variables their allowed values', () => {
    expect(RULE_VARIABLES.market.values).toEqual(['IN', 'US']);
    expect(RULE_VARIABLES.exchange.values).toContain('NYSE_ARCA');
    expect(RULE_VARIABLES.healthLabel.values).toEqual(['GOOD', 'AVERAGE', 'BAD']);
  });
});
