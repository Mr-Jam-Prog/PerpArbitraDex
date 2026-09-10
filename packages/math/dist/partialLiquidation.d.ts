/**
 * Partial Liquidation Math & Feasibility Prototype (Prompt 07C-A-R4)
 * Formally defined according to docs/ECONOMIC_SPEC.md & PROMPT 07C-A-R4 requirements.
 */
export declare enum CollateralPolicy {
    POLICY_A = "POLICY_A",// Voluntary-decrease style proportional margin withdrawal
    POLICY_B = "POLICY_B",// Pure retain collateral / pure deleveraging
    POLICY_C_C = "POLICY_C_C"
}
export declare enum SizingMode {
    NONE = "NONE",
    PARTIAL_CONSERVATIVE = "PARTIAL_CONSERVATIVE",
    PARTIAL_EXACT_RESEARCH = "PARTIAL_EXACT_RESEARCH",
    FULL_FALLBACK = "FULL_FALLBACK"
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
    nominalClosedLossWad: bigint;
    closedLossNative: bigint;
    effectiveClosedLossWad: bigint;
    nominalClosedProfitWad: bigint;
    closedProfitNative: bigint;
    effectiveClosedProfitWad: bigint;
    nominalClosedNetPnlWad: bigint;
    closedNetProfitNative: bigint;
    effectiveClosedNetProfitWad: bigint;
    closedNetDeficitNative: bigint;
    effectiveClosedNetDeficitWad: bigint;
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
export interface PartialSizingRecommendation {
    recommendedDeltaSWad: bigint;
    mode: SizingMode;
    willFullyLiquidate: boolean;
    partialResult?: PartialLiquidationResult;
    fallbackReason?: string;
    evaluationCount?: number;
}
/**
 * Validates that targetHfWad meets the minimum protocol liquidation threshold floor (WAD = 1e18).
 */
export declare function validateTargetHfWad(targetHfWad: bigint): void;
/**
 * Evaluates pre-liquidation base position state after funding settlement on S0.
 */
export declare function evaluateBasePosition(s0Wad: bigint, m0Wad: bigint, entryPrice8d: bigint, currentPrice8d: bigint, isLong: boolean, fundingPaymentWad: bigint, maintenanceMarginBps: bigint, quoteDecimals: number): BasePositionStateResult;
/**
 * Simulates partial liquidation for given size and policy.
 * Domain is strictly 0 < deltaSWad < s0Wad. Full liquidation (deltaSWad >= s0Wad) is rejected.
 */
export declare function simulatePartialLiquidation(params: PartialLiquidationParams): PartialLiquidationResult;
/**
 * Research-only Conservative Upper-Bound Predicate for Policy B (`ConservativeSafeB`).
 * Evaluates whether deltaSWad satisfies Policy B under worst-case rounding bounds.
 * Note: Non-monotonic due to discrete native quantization boundaries; NOT suitable for binary search.
 */
export declare function isConservativeSafePolicyB(params: PartialLiquidationParams): boolean;
/**
 * Exhaustive Minimum Safe Size Solver over small integer domains (TEST / RESEARCH ONLY).
 * Iterates sequentially through all integer step units to find the exact minimum safe size
 * without relying on binary search over non-monotonic predicates.
 */
export declare function findMinimumSafePolicyBSizeExhaustive(params: Omit<PartialLiquidationParams, "deltaSWad" | "policy">, stepWad?: bigint): PartialSizingRecommendation;
/**
 * Quarantined/retired binary search solver. Returns FULL_FALLBACK by default to reflect
 * non-monotonicity of exact/conservative safety predicates.
 */
export declare function findMinimumSafePolicyBSize(params: Omit<PartialLiquidationParams, "deltaSWad" | "policy">): PartialSizingRecommendation;
/**
 * Backward compatibility alias for findMinimumSafePolicyBSize.
 */
export declare function findMinimumSafePartialSize(params: Omit<PartialLiquidationParams, "deltaSWad">): PartialSizingRecommendation;
