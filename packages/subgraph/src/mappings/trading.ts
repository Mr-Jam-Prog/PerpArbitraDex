// Trading mappings for PerpArbitraDEX
// Version: 1.0.0
// Events handled: PositionOpened, PositionIncreased, PositionDecreased, PositionClosed, LiquidationExecuted, FundingAccrued

import {
    PositionOpened as PositionOpenedEvent,
    PositionIncreased as PositionIncreasedEvent,
    PositionDecreased as PositionDecreasedEvent,
    PositionClosed as PositionClosedEvent,
    PositionLiquidated as LiquidationExecutedEvent,
    FundingAccrued as FundingAccruedEvent
} from "../generated/PerpEngine/PerpEngine";
import {
    Position,
    Trade,
    Market,
    User,
    Protocol,
    FundingUpdate
} from "../../generated/schema";
import { BigInt, Address, Bytes, store } from "@graphprotocol/graph-ts";

// Constants
const ONE = BigInt.fromI32(1);
const DECIMALS = BigInt.fromI32(18);
const PRICE_DECIMALS = BigInt.fromI32(8);

/**
 * Handle PositionOpened event
 * Idempotent: Uses event.transaction.hash + event.logIndex for unique trade ID
 */
export function handlePositionOpened(event: PositionOpenedEvent): void {
    // Create unique ID for idempotence
    const tradeId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
    
    // Atomic: Load or create user
    let user = User.load(event.params.trader.toHexString());
    if (!user) {
        user = new User(event.params.trader.toHexString());
        user.totalVolume = BigInt.fromI32(0);
        user.totalTrades = 0;
        user.totalPnl = BigInt.fromI32(0);
        user.totalFees = BigInt.fromI32(0);
        user.totalFunding = BigInt.fromI32(0);
        user.liquidations = 0;
        user.firstSeen = event.block.timestamp;
        user.lastSeen = event.block.timestamp;
    } else {
        user.lastSeen = event.block.timestamp;
    }
    user.save();

    // Create position
    const positionId = event.params.positionId.toString();
    let position = Position.load(positionId);
    if (!position) {
        position = new Position(positionId);
        position.user = event.params.trader.toHexString();
        position.market = event.params.marketId.toString();
        position.size = event.params.size;
        position.collateral = event.params.margin;
        position.entryPrice = event.params.entryPrice;
        position.isLong = event.params.isLong;
        position.leverage = event.params.leverage;
        position.entryTime = event.block.timestamp;
        position.lastUpdated = event.block.timestamp;
        position.healthFactor = calculateInitialHealthFactor(
            event.params.margin,
            event.params.size,
            event.params.entryPrice,
            event.params.isLong
        );
        position.isLiquidated = false;
        position.isClosed = false;
        position.totalFunding = BigInt.fromI32(0);
        position.save();
    }

    // Create trade
    let trade = Trade.load(tradeId);
    if (!trade) {
        trade = new Trade(tradeId);
        trade.position = positionId;
        trade.user = event.params.trader.toHexString();
        trade.market = event.params.marketId.toString();
        trade.size = event.params.size;
        trade.price = event.params.entryPrice;
        trade.collateralDelta = event.params.margin;
        trade.isOpen = true;
        trade.timestamp = event.block.timestamp;
        trade.txHash = event.transaction.hash;
        trade.blockNumber = event.block.number;
        trade.fee = event.params.protocolFee;
        trade.save();
    }

    // Update user stats
    user.totalTrades += 1;
    user.totalFees = user.totalFees.plus(event.params.protocolFee);
    user.totalVolume = user.totalVolume.plus(event.params.size);
    user.save();

    // Update market open interest
    updateMarketOpenInterest(event.params.marketId, event.params.size, true, event.params.isLong);

    // Update protocol stats
    updateProtocolStats(event.params.size, true, event.params.protocolFee, event.block.timestamp);
}

/**
 * Handle PositionIncreased event
 * Idempotent: Uses unique trade ID
 */
export function handlePositionIncreased(event: PositionIncreasedEvent): void {
    const tradeId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
    const positionId = event.params.positionId.toString();
    
    // Atomic: Load position
    let position = Position.load(positionId);
    if (!position) {
        // Position should exist, skip
        return;
    }

    // Update position
    position.size = position.size.plus(event.params.sizeAdded);
    position.collateral = position.collateral.plus(event.params.marginAdded);
    position.entryPrice = event.params.newEntryPrice;
    position.lastUpdated = event.block.timestamp;
    
    // Recalculate health factor
    position.healthFactor = calculateHealthFactor(
        position.collateral,
        position.size,
        position.entryPrice,
        position.isLong
    );
    position.save();

    // Create trade for increase
    let trade = Trade.load(tradeId);
    if (!trade) {
        trade = new Trade(tradeId);
        trade.position = positionId;
        trade.user = position.user;
        trade.market = position.market;
        trade.size = event.params.sizeAdded;
        trade.price = event.params.newEntryPrice;
        trade.collateralDelta = event.params.marginAdded;
        trade.isOpen = true; // Increasing position
        trade.timestamp = event.block.timestamp;
        trade.txHash = event.transaction.hash;
        trade.blockNumber = event.block.number;
        trade.fee = event.params.protocolFee;
        trade.save();
    }

    // Update user stats
    let user = User.load(position.user);
    if (user) {
        user.totalTrades += 1;
        user.totalFees = user.totalFees.plus(event.params.protocolFee);
        user.totalVolume = user.totalVolume.plus(event.params.sizeAdded);
        user.save();
    }

    // Update market open interest
    updateMarketOpenInterest(BigInt.fromString(position.market), event.params.sizeAdded, true, position.isLong);

    // Update protocol stats
    updateProtocolStats(event.params.sizeAdded, true, event.params.protocolFee, event.block.timestamp);
}

/**
 * Handle PositionDecreased event
 * Idempotent: Uses unique trade ID
 */
export function handlePositionDecreased(event: PositionDecreasedEvent): void {
    const tradeId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
    const positionId = event.params.positionId.toString();
    
    // Atomic: Load position
    let position = Position.load(positionId);
    if (!position) {
        return;
    }

    // Update position
    position.size = position.size.minus(event.params.sizeReduced);
    position.collateral = position.collateral.minus(event.params.marginReduced);
    position.lastUpdated = event.block.timestamp;
    
    // Recalculate health factor
    position.healthFactor = calculateHealthFactor(
        position.collateral,
        position.size,
        position.entryPrice,
        position.isLong
    );
    
    // Check if position is fully closed
    if (position.size.equals(BigInt.fromI32(0))) {
        position.isClosed = true;
    }
    position.save();

    // Create trade for decrease
    let trade = Trade.load(tradeId);
    if (!trade) {
        trade = new Trade(tradeId);
        trade.position = positionId;
        trade.user = position.user;
        trade.market = position.market;
        trade.size = event.params.sizeReduced.neg(); // Negative for decrease
        trade.price = BigInt.fromI32(0); // Would get from oracle
        trade.collateralDelta = event.params.marginReduced.neg();
        trade.isOpen = false; // Decreasing position
        trade.timestamp = event.block.timestamp;
        trade.txHash = event.transaction.hash;
        trade.blockNumber = event.block.number;
        trade.pnl = event.params.pnl;
        trade.save();
    }

    // Update user stats
    let user = User.load(position.user);
    if (user) {
        user.totalTrades += 1;
        user.totalPnl = user.totalPnl.plus(event.params.pnl);
        user.save();
    }

    // Update market open interest
    updateMarketOpenInterest(BigInt.fromString(position.market), event.params.sizeReduced, false, position.isLong);

    // Update protocol stats
    updateProtocolStats(event.params.sizeReduced, false, BigInt.fromI32(0), event.block.timestamp);
}

/**
 * Handle PositionClosed event
 * Idempotent: Uses unique trade ID
 */
export function handlePositionClosed(event: PositionClosedEvent): void {
    const positionId = event.params.positionId.toString();
    
    // Atomic: Load position
    let position = Position.load(positionId);
    if (!position) {
        return;
    }

    // Mark position as closed
    position.isClosed = true;
    position.lastUpdated = event.block.timestamp;
    position.save();

    // Update user stats
    let user = User.load(position.user);
    if (user) {
        user.totalTrades += 1;
        user.totalPnl = user.totalPnl.plus(event.params.pnl);
        user.save();
    }

    // Update market open interest
    updateMarketOpenInterest(BigInt.fromString(position.market), position.size, false, position.isLong);

    // Update protocol stats
    updateProtocolStats(position.size, false, BigInt.fromI32(0), event.block.timestamp);
}

/**
 * Handle LiquidationExecuted event
 * Idempotent: Uses unique ID
 */
export function handleLiquidationExecuted(event: LiquidationExecutedEvent): void {
    const positionId = event.params.positionId.toString();
    
    // Atomic: Load position
    let position = Position.load(positionId);
    if (!position) {
        return;
    }

    // Mark position as liquidated
    position.isLiquidated = true;
    position.isClosed = true;
    position.lastUpdated = event.block.timestamp;
    position.save();

    // Update user stats
    let user = User.load(position.user);
    if (user) {
        user.liquidations += 1;
        user.save();
    }

    // Update market open interest
    updateMarketOpenInterest(BigInt.fromString(position.market), position.size, false, position.isLong);

    // Update protocol stats for liquidation
    let protocol = Protocol.load("1");
    if (!protocol) {
        protocol = createDefaultProtocol(event.block.timestamp);
    }
    protocol.totalLiquidations = protocol.totalLiquidations.plus(ONE);
    protocol.lastUpdated = event.block.timestamp;
    protocol.save();
}

/**
 * Handle FundingAccrued event
 * Idempotent: Uses unique funding ID
 */
export function handleFundingAccrued(event: FundingAccruedEvent): void {
    const fundingId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
    
    // Create funding update
    let fundingUpdate = FundingUpdate.load(fundingId);
    if (!fundingUpdate) {
        fundingUpdate = new FundingUpdate(fundingId);
        fundingUpdate.market = event.params.marketId.toString();
        fundingUpdate.fundingRate = event.params.fundingRate;
        fundingUpdate.fundingAccumulatedLong = event.params.fundingAccumulatedLong;
        fundingUpdate.fundingAccumulatedShort = event.params.fundingAccumulatedShort;
        fundingUpdate.timestamp = event.block.timestamp;
        fundingUpdate.txHash = event.transaction.hash;
        fundingUpdate.blockNumber = event.block.number;
        fundingUpdate.save();
    }

    // Update market funding rate
    let market = Market.load(event.params.marketId.toString());
    if (market) {
        market.fundingRate = event.params.fundingRate;
        market.lastFundingTime = event.params.timestamp;
        market.save();
    }
}

// ============ HELPER FUNCTIONS ============

function calculateInitialHealthFactor(
    collateral: BigInt,
    size: BigInt,
    entryPrice: BigInt,
    isLong: boolean
): BigInt {
    if (size.equals(BigInt.fromI32(0))) {
        return BigInt.fromI32(1000000); // 1.0
    }

    // Simplified calculation - in production would use maintenance margin
    const sizeValue = size.times(entryPrice).div(DECIMALS);
    const maintenanceRequired = sizeValue.div(BigInt.fromI32(20)); // 5% maintenance

    if (maintenanceRequired.equals(BigInt.fromI32(0))) {
        return BigInt.fromI32(1000000);
    }

    // Health factor = collateral / maintenanceRequired
    return collateral.times(BigInt.fromI32(1000000)).div(maintenanceRequired);
}

function calculateHealthFactor(
    collateral: BigInt,
    size: BigInt,
    entryPrice: BigInt,
    isLong: boolean
): BigInt {
    return calculateInitialHealthFactor(collateral, size, entryPrice, isLong);
}

function updateMarketOpenInterest(marketId: BigInt, size: BigInt, isIncrease: boolean, isLong: boolean): void {
    let market = Market.load(marketId.toString());
    if (!market) {
        market = createDefaultMarket(marketId.toString());
    }

    if (isLong) {
        market.longOpenInterest = isIncrease
            ? market.longOpenInterest.plus(size)
            : market.longOpenInterest.minus(size);
    } else {
        market.shortOpenInterest = isIncrease
            ? market.shortOpenInterest.plus(size)
            : market.shortOpenInterest.minus(size);
    }

    market.openInterest = market.longOpenInterest.plus(market.shortOpenInterest);
    market.skew = market.longOpenInterest.minus(market.shortOpenInterest);
    market.save();
}

function updateProtocolStats(size: BigInt, isOpen: boolean, fee: BigInt, timestamp: BigInt): void {
    let protocol = Protocol.load("1");
    if (!protocol) {
        protocol = createDefaultProtocol(timestamp);
    }

    if (isOpen) {
        protocol.totalOpenInterest = protocol.totalOpenInterest.plus(size);
    } else {
        protocol.totalOpenInterest = protocol.totalOpenInterest.minus(size);
    }

    protocol.totalVolume = protocol.totalVolume.plus(size);
    protocol.totalFees = protocol.totalFees.plus(fee);
    protocol.totalTrades = protocol.totalTrades.plus(ONE);
    protocol.lastUpdated = timestamp;
    protocol.save();
}

function createDefaultMarket(marketId: string): Market {
    let market = new Market(marketId);
    market.symbol = "UNKNOWN";
    market.baseAsset = Address.zero();
    market.quoteAsset = Address.zero();
    market.oracle = Address.zero();
    market.isActive = true;
    market.isPaused = false;
    market.maxLeverage = BigInt.fromI32(100);
    market.initialMargin = BigInt.fromI32(10);
    market.maintenanceMargin = BigInt.fromI32(5);
    market.liquidationFee = BigInt.fromI32(20);
    market.openInterest = BigInt.fromI32(0);
    market.longOpenInterest = BigInt.fromI32(0);
    market.shortOpenInterest = BigInt.fromI32(0);
    market.skew = BigInt.fromI32(0);
    market.fundingRate = BigInt.fromI32(0);
    market.fundingVelocity = BigInt.fromI32(0);
    market.lastFundingTime = BigInt.fromI32(0);
    market.save();

    return market;
}

function createDefaultProtocol(timestamp: BigInt): Protocol {
    let protocol = new Protocol("1");
    protocol.totalValueLocked = BigInt.fromI32(0);
    protocol.totalOpenInterest = BigInt.fromI32(0);
    protocol.totalVolume = BigInt.fromI32(0);
    protocol.totalTrades = BigInt.fromI32(0);
    protocol.totalFees = BigInt.fromI32(0);
    protocol.totalLiquidations = BigInt.fromI32(0);
    protocol.activeTraders24h = 0;
    protocol.activeMarkets = 0;
    protocol.lastUpdated = timestamp;
    protocol.save();

    return protocol;
}