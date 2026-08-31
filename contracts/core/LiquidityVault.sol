// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";

import {ILiquidityVault} from "../interfaces/ILiquidityVault.sol";

/**
 * @title LiquidityVault
 * @notice Asset-backed vault serving as the economic counterparty for the DEX (ADR-001)
 * @dev Manages LP capital, trader margin deposits, insurance fund reserves, and protocol fees.
 */
contract LiquidityVault is ILiquidityVault, ERC20, Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ============ STATE VARIABLES ============

    IERC20 public immutable quoteToken;
    uint8 private immutable _tokenDecimals;

    address public perpEngine;
    uint256 public depositCap = type(uint256).max;

    // Ledger balances
    uint256 public totalLpAssets;
    uint256 public lockedLiquidity;
    uint256 public traderMarginTotal;
    uint256 public insuranceFundBalance;
    uint256 public protocolFeeBalance;

    // ============ MODIFIERS ============

    modifier onlyPerpEngine() {
        require(msg.sender == perpEngine, "Vault: only PerpEngine");
        _;
    }

    // ============ CONSTRUCTOR ============

    constructor(
        address quoteToken_,
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) {
        require(quoteToken_ != address(0), "Vault: zero address");
        quoteToken = IERC20(quoteToken_);

        uint8 dec = 18;
        try IERC20Metadata(quoteToken_).decimals() returns (uint8 d) {
            dec = d;
        } catch {}
        _tokenDecimals = dec;
    }

    function decimals() public view override returns (uint8) {
        return _tokenDecimals;
    }

    function asset() external view override returns (address) {
        return address(quoteToken);
    }

    // ============ ERC4626 VIEWS ============

    function totalAssets() public view override returns (uint256) {
        return totalLpAssets;
    }

    function availableLiquidity() public view override returns (uint256) {
        if (totalLpAssets > lockedLiquidity) {
            return totalLpAssets - lockedLiquidity;
        }
        return 0;
    }

    function convertToShares(uint256 assets) public view override returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0 || totalLpAssets == 0) {
            return assets;
        }
        return (assets * supply) / totalLpAssets;
    }

    function convertToAssets(uint256 shares) public view override returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) {
            return shares;
        }
        return (shares * totalLpAssets) / supply;
    }

    function previewDeposit(uint256 assets) public view override returns (uint256) {
        return convertToShares(assets);
    }

    function previewMint(uint256 shares) public view override returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0 || totalLpAssets == 0) {
            return shares;
        }
        // Round up assets needed for minting shares
        return (shares * totalLpAssets + supply - 1) / supply;
    }

    function previewWithdraw(uint256 assets) public view override returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0 || totalLpAssets == 0) {
            return assets;
        }
        // Round up shares needed to withdraw exact assets
        return (assets * supply + totalLpAssets - 1) / totalLpAssets;
    }

    function previewRedeem(uint256 shares) public view override returns (uint256) {
        return convertToAssets(shares);
    }

    // ============ LP ACTIONS ============

    function deposit(uint256 assets, address receiver)
        external
        override
        nonReentrant
        whenNotPaused
        returns (uint256 shares)
    {
        require(assets > 0, "Vault: zero assets");
        require(totalLpAssets + assets <= depositCap, "Vault: deposit cap exceeded");

        shares = convertToShares(assets);
        require(shares > 0, "Vault: zero shares");

        quoteToken.safeTransferFrom(msg.sender, address(this), assets);
        totalLpAssets += assets;
        _mint(receiver, shares);

        emit DepositLP(msg.sender, receiver, assets, shares);
    }

    function mint(uint256 shares, address receiver)
        external
        override
        nonReentrant
        whenNotPaused
        returns (uint256 assets)
    {
        require(shares > 0, "Vault: zero shares");
        assets = previewMint(shares);
        require(assets > 0, "Vault: zero assets");
        require(totalLpAssets + assets <= depositCap, "Vault: deposit cap exceeded");

        quoteToken.safeTransferFrom(msg.sender, address(this), assets);
        totalLpAssets += assets;
        _mint(receiver, shares);

        emit DepositLP(msg.sender, receiver, assets, shares);
    }

    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    )
        external
        override
        nonReentrant
        whenNotPaused
        returns (uint256 shares)
    {
        require(assets > 0, "Vault: zero assets");
        require(availableLiquidity() >= assets, "Vault: insufficient available liquidity");

        shares = previewWithdraw(assets);
        require(shares > 0, "Vault: zero shares");

        if (msg.sender != owner) {
            uint256 allowed = allowance(owner, msg.sender);
            if (allowed != type(uint256).max) {
                require(allowed >= shares, "Vault: insufficient allowance");
                _approve(owner, msg.sender, allowed - shares);
            }
        }

        _burn(owner, shares);
        totalLpAssets -= assets;
        quoteToken.safeTransfer(receiver, assets);

        emit WithdrawLP(msg.sender, receiver, owner, assets, shares);
    }

    function redeem(
        uint256 shares,
        address receiver,
        address owner
    )
        external
        override
        nonReentrant
        whenNotPaused
        returns (uint256 assets)
    {
        require(shares > 0, "Vault: zero shares");
        assets = convertToAssets(shares);
        require(assets > 0, "Vault: zero assets");
        require(availableLiquidity() >= assets, "Vault: insufficient available liquidity");

        if (msg.sender != owner) {
            uint256 allowed = allowance(owner, msg.sender);
            if (allowed != type(uint256).max) {
                require(allowed >= shares, "Vault: insufficient allowance");
                _approve(owner, msg.sender, allowed - shares);
            }
        }

        _burn(owner, shares);
        totalLpAssets -= assets;
        quoteToken.safeTransfer(receiver, assets);

        emit WithdrawLP(msg.sender, receiver, owner, assets, shares);
    }

    // ============ ENGINE RESTRICTED FUNCTIONS ============

    function depositTraderMargin(address trader, uint256 amount)
        external
        override
        onlyPerpEngine
        nonReentrant
    {
        if (amount == 0) return;
        quoteToken.safeTransferFrom(trader, address(this), amount);
        traderMarginTotal += amount;
        emit MarginDeposited(trader, amount);
    }

    function withdrawTraderMargin(address trader, uint256 amount)
        external
        override
        onlyPerpEngine
        nonReentrant
    {
        if (amount == 0) return;
        require(traderMarginTotal >= amount, "Vault: margin underflow");
        traderMarginTotal -= amount;
        quoteToken.safeTransfer(trader, amount);
        emit MarginWithdrawn(trader, amount);
    }

    function lockLiquidity(uint256 amount) external override onlyPerpEngine {
        require(availableLiquidity() >= amount, "Vault: insufficient liquidity to lock");
        lockedLiquidity += amount;
        emit LiquidityLocked(amount, lockedLiquidity);
    }

    function unlockLiquidity(uint256 amount) external override onlyPerpEngine {
        if (amount >= lockedLiquidity) {
            lockedLiquidity = 0;
        } else {
            lockedLiquidity -= amount;
        }
        emit LiquidityUnlocked(amount, lockedLiquidity);
    }

    function settleTraderProfit(
        address trader,
        uint256 marginToReturn,
        uint256 profit
    )
        external
        override
        onlyPerpEngine
        nonReentrant
        returns (uint256 profitPaid, uint256 unbackedProfit)
    {
        require(traderMarginTotal >= marginToReturn, "Vault: margin underflow");
        traderMarginTotal -= marginToReturn;

        if (profit > 0) {
            if (totalLpAssets >= profit) {
                profitPaid = profit;
                unbackedProfit = 0;
                totalLpAssets -= profit;
            } else {
                profitPaid = totalLpAssets;
                unbackedProfit = profit - totalLpAssets;
                totalLpAssets = 0;
            }
        }

        uint256 totalPayout = marginToReturn + profitPaid;
        if (totalPayout > 0) {
            quoteToken.safeTransfer(trader, totalPayout);
        }

        emit TraderProfitSettled(trader, marginToReturn, profitPaid, unbackedProfit);
    }

    function settleTraderLoss(
        address trader,
        uint256 marginToReturn,
        uint256 loss
    )
        external
        override
        onlyPerpEngine
        nonReentrant
    {
        uint256 totalMarginNeeded = marginToReturn + loss;
        require(traderMarginTotal >= totalMarginNeeded, "Vault: margin underflow");

        traderMarginTotal -= totalMarginNeeded;
        totalLpAssets += loss;

        if (marginToReturn > 0) {
            quoteToken.safeTransfer(trader, marginToReturn);
        }

        emit TraderLossSettled(trader, marginToReturn, loss);
    }

    function settleBadDebt(
        address trader,
        uint256 marginForfeited,
        uint256 totalDeficit
    )
        external
        override
        onlyPerpEngine
        nonReentrant
        returns (uint256 coveredByIF, uint256 coveredByLP, uint256 residualBadDebt)
    {
        require(traderMarginTotal >= marginForfeited, "Vault: margin underflow");
        traderMarginTotal -= marginForfeited;

        if (marginForfeited >= totalDeficit) {
            uint256 excessMargin = marginForfeited - totalDeficit;
            totalLpAssets += excessMargin;
            coveredByIF = 0;
            coveredByLP = 0;
            residualBadDebt = 0;
        } else {
            uint256 remainingDeficit = totalDeficit - marginForfeited;

            // Step 2: Insurance Fund
            if (insuranceFundBalance >= remainingDeficit) {
                coveredByIF = remainingDeficit;
                insuranceFundBalance -= remainingDeficit;
                remainingDeficit = 0;
            } else {
                coveredByIF = insuranceFundBalance;
                remainingDeficit -= insuranceFundBalance;
                insuranceFundBalance = 0;
            }

            // Step 3: LP Capital
            if (remainingDeficit > 0) {
                if (totalLpAssets >= remainingDeficit) {
                    coveredByLP = remainingDeficit;
                    totalLpAssets -= remainingDeficit;
                    remainingDeficit = 0;
                } else {
                    coveredByLP = totalLpAssets;
                    remainingDeficit -= totalLpAssets;
                    totalLpAssets = 0;
                }
            }

            residualBadDebt = remainingDeficit;
        }

        emit BadDebtSettled(trader, marginForfeited, coveredByIF, coveredByLP, residualBadDebt);
    }

    function collectProtocolFees(uint256 feeAmount) external override onlyPerpEngine {
        if (feeAmount == 0) return;
        require(traderMarginTotal >= feeAmount, "Vault: margin underflow for fees");
        traderMarginTotal -= feeAmount;
        protocolFeeBalance += feeAmount;
        emit ProtocolFeesCollected(feeAmount, protocolFeeBalance);
    }

    function fundInsuranceFund(uint256 amount) external override onlyPerpEngine {
        if (amount == 0) return;
        require(traderMarginTotal >= amount, "Vault: margin underflow for IF");
        traderMarginTotal -= amount;
        insuranceFundBalance += amount;
        emit InsuranceFundDeposited(amount, insuranceFundBalance);
    }

    // ============ ADMIN ACTIONS ============

    function setPerpEngine(address newEngine) external override onlyOwner {
        require(newEngine != address(0), "Vault: zero address");
        perpEngine = newEngine;
        emit PerpEngineUpdated(newEngine);
    }

    function setDepositCap(uint256 newCap) external override onlyOwner {
        depositCap = newCap;
        emit DepositCapUpdated(newCap);
    }

    function pause() external override onlyOwner {
        _pause();
    }

    function unpause() external override onlyOwner {
        _unpause();
    }

    function withdrawProtocolFees(address recipient, uint256 amount) external override onlyOwner nonReentrant {
        require(recipient != address(0), "Vault: zero address");
        require(protocolFeeBalance >= amount, "Vault: insufficient fee balance");
        protocolFeeBalance -= amount;
        quoteToken.safeTransfer(recipient, amount);
        emit ProtocolFeesWithdrawn(recipient, amount);
    }

    function withdrawInsuranceFund(address recipient, uint256 amount) external override onlyOwner nonReentrant {
        require(recipient != address(0), "Vault: zero address");
        require(insuranceFundBalance >= amount, "Vault: insufficient IF balance");
        insuranceFundBalance -= amount;
        quoteToken.safeTransfer(recipient, amount);
        emit InsuranceFundWithdrawn(recipient, amount);
    }
}
