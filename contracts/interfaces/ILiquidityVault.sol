// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title ILiquidityVault
 * @notice Interface for the asset-backed LiquidityVault (ADR-001)
 */
interface ILiquidityVault is IERC20 {
    // ============ EVENTS ============

    event DepositLP(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
    event WithdrawLP(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);
    event MarginDeposited(address indexed trader, uint256 amount);
    event MarginWithdrawn(address indexed trader, uint256 amount);
    event LiquidityLocked(uint256 amount, uint256 totalLocked);
    event LiquidityUnlocked(uint256 amount, uint256 totalLocked);
    event TraderProfitSettled(address indexed trader, uint256 marginReturned, uint256 profitPaid, uint256 unbackedProfit);
    event TraderLossSettled(address indexed trader, uint256 marginReturned, uint256 lossToVault);
    event BadDebtSettled(
        address indexed trader,
        uint256 marginForfeited,
        uint256 coveredByInsurance,
        uint256 coveredByLP,
        uint256 residualBadDebt
    );
    event ProtocolFeesCollected(uint256 amount, uint256 totalProtocolFees);
    event ProtocolFeesWithdrawn(address indexed recipient, uint256 amount);
    event InsuranceFundDeposited(uint256 amount, uint256 totalInsurance);
    event InsuranceFundWithdrawn(address indexed recipient, uint256 amount);
    event DepositCapUpdated(uint256 newCap);
    event PerpEngineUpdated(address indexed newPerpEngine);

    // ============ ERC4626 & ACCOUNTING VIEWS ============

    function decimals() external view returns (uint8);
    function asset() external view returns (address);
    function totalAssets() external view returns (uint256);
    function totalLpAssets() external view returns (uint256);
    function lockedLiquidity() external view returns (uint256);
    function availableLiquidity() external view returns (uint256);
    function traderMarginTotal() external view returns (uint256);
    function insuranceFundBalance() external view returns (uint256);
    function protocolFeeBalance() external view returns (uint256);
    function depositCap() external view returns (uint256);
    function perpEngine() external view returns (address);

    function convertToShares(uint256 assets) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function previewDeposit(uint256 assets) external view returns (uint256);
    function previewMint(uint256 shares) external view returns (uint256);
    function previewWithdraw(uint256 assets) external view returns (uint256);
    function previewRedeem(uint256 shares) external view returns (uint256);

    // ============ LP USER ACTIONS ============

    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function mint(uint256 shares, address receiver) external returns (uint256 assets);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);

    // ============ ENGINE RESTRICTED SETTLEMENTS ============

    function depositTraderMargin(address trader, uint256 amount) external;
    function withdrawTraderMargin(address trader, uint256 amount) external;
    function creditTraderMarginFromLP(address trader, uint256 amount) external;
    function lockLiquidity(uint256 amount) external;
    function unlockLiquidity(uint256 amount) external;

    function settleTraderProfit(
        address trader,
        uint256 marginToReturn,
        uint256 profit
    ) external returns (uint256 profitPaid, uint256 unbackedProfit);

    function settleTraderLoss(
        address trader,
        uint256 marginToReturn,
        uint256 loss
    ) external;

    /**
     * @notice Settles bad debt from an insolvent position using the protocol waterfall.
     * @param trader Trader address whose position is insolvent.
     * @param marginForfeited Collateral forfeited by trader to LP assets.
     * @param totalDeficit Gross realized deficit of the position.
     * @return coveredByIF Amount covered by Insurance Fund reclassification to LP assets.
     * @return coveredByLP Economic amount of unrecovered trader deficit ultimately absorbed by LPs.
     *         It does not trigger an additional totalLpAssets debit because the missing trader payment
     *         is a foregone receivable, not a physical token outflow.
     * @return residualBadDebt Amount remaining after the configured terminal waterfall.
     *         Under the current MVP waterfall where LPs are the terminal absorber,
     *         residualBadDebt is zero after successful settleBadDebt.
     */
    function settleBadDebt(
        address trader,
        uint256 marginForfeited,
        uint256 totalDeficit
    ) external returns (uint256 coveredByIF, uint256 coveredByLP, uint256 residualBadDebt);

    function collectProtocolFees(uint256 feeAmount) external;
    function fundInsuranceFund(uint256 amount) external;
    function payLiquidationReward(address liquidator, uint256 amount) external;

    // ============ ADMIN ACTIONS ============

    function setPerpEngine(address newEngine) external;
    function setDepositCap(uint256 newCap) external;
    function pause() external;
    function unpause() external;
    function withdrawProtocolFees(address recipient, uint256 amount) external;
    function withdrawInsuranceFund(address recipient, uint256 amount) external;
}