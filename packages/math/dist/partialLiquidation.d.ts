/**
 * Partial Liquidation Math & Feasibility Prototype (Prompt 07C-A-R1)
 * Formally defined according to docs/ECONOMIC_SPEC.md & PROMPT 07C-A-R1 requirements.
 */
export declare enum CollateralPolicy {
    POLICY_A = "POLICY_A",// Voluntary-decrease style proportional margin withdrawal
    POLICY_B = "POLICY_B",// Pure retain collateral / pure deleveraging
    POLICY_C_C = "POLICY_C_C"
}
export interface PartialLiquidationParams {
    s0Wad: bigint;
    m0Wad: bigint;
    deltaSWad: bigint;
    entryPrice8d: bigint;
    currentPrice8d: bigint;
    isLong: boolean;
    fundingPaymentWad: bigint;
    targetHfWad: bigint;
    policy: CollateralPolicy;
    liqFeeRatioBps: bigint;
    maintenanceMarginBps: bigint;
    minMarginRatioBps?: bigint;
    quoteDecimals: number;
    minPositionSizeWad: bigint;
}
export interface BasePositionStateResult {
    m1Wad: bigint;
    unpaidFundingWad: bigint;
    pnl0Wad: bigint;
    equity0Wad: bigint;
    mm0Wad: bigint;
    hf0Wad: bigint;
    isLiquidatable: boolean;
}
export interface PartialLiquidationResult {
    baseState: BasePositionStateResult;
    deltaSWad: bigint;
    remainingSizeWad: bigint;
    policy: CollateralPolicy;
    notionalClosedWad: bigint;
    nominalPenaltyWad: bigint;
    penaltyNative: bigint;
    effectivePenaltyWad: bigint;
    nominalRewardWad: bigint;
    rewardNative: bigint;
    effectiveRewardWad: bigint;
    pnlClosedWad: bigint;
    pnlRemainingWad: bigint;
    pnlRoundingResidualWad: bigint;
    unpaidFundingBeforeWad: bigint;
    unpaidFundingAfterWad: bigint;
    mPostWad: bigint;
    equityPostWad: bigint;
    mmRemainingWad: bigint;
    minMarginRequiredWad: bigint;
    hfPostWad: bigint;
    traderPayoutWad: bigint;
    residualBadDebtWad: bigint;
    externalBadDebtRequired: boolean;
    isSafe: boolean;
    fallbackReason?: string;
}
/**
 * Evaluates pre-liquidation base position state after funding settlement on S0.
 */
export declare function evaluateBasePosition(s0Wad: bigint, m0Wad: bigint, entryPrice8d: bigint, currentPrice8d: bigint, isLong: boolean, fundingPaymentWad: bigint, maintenanceMarginBps: bigint, quoteDecimals: number): BasePositionStateResult;
/**
 * Simulates partial liquidation for given size and policy.
 */
export declare function simulatePartialLiquidation(params: PartialLiquidationParams): PartialLiquidationResult;
/**
 * Finds the minimum safe partial liquidation size using continuous analytical seed + tight discrete verification.
 */
export declare function findMinimumSafePartialSize(params: Omit<PartialLiquidationParams, "deltaSWad">): {
    recommendedDeltaSWad: bigint;
    willFullyLiquidate: boolean;
    result: PartialLiquidationResult;
    fallbackReason?: string;
};
