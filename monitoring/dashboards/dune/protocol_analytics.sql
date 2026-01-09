-- PerpArbitraDEX Protocol Analytics Dashboard
-- Dune Analytics SQL Queries
-- Version: 1.0.0

-- ============================================
-- QUERY 1: Daily Trading Volume
-- ============================================

WITH daily_volume AS (
  SELECT
    DATE_TRUNC('day', evt_block_time) AS day,
    SUM(
      CASE 
        WHEN CAST(size AS DOUBLE) / 1e18 > 0 THEN CAST(size AS DOUBLE) / 1e18
        ELSE ABS(CAST(size AS DOUBLE) / 1e18)
      END
    ) AS volume_usd
  FROM perp_arbitra_dex."PerpEngine_evt_PositionOpened"
  WHERE evt_block_time >= NOW() - INTERVAL '90 days'
  GROUP BY 1
  
  UNION ALL
  
  SELECT
    DATE_TRUNC('day', evt_block_time) AS day,
    SUM(
      CASE 
        WHEN CAST(size AS DOUBLE) / 1e18 > 0 THEN CAST(size AS DOUBLE) / 1e18
        ELSE ABS(CAST(size AS DOUBLE) / 1e18)
      END
    ) AS volume_usd
  FROM perp_arbitra_dex."PerpEngine_evt_PositionClosed"
  WHERE evt_block_time >= NOW() - INTERVAL '90 days'
  GROUP BY 1
)

SELECT
  day,
  SUM(volume_usd) AS daily_volume_usd,
  AVG(SUM(volume_usd)) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS volume_7d_ma
FROM daily_volume
GROUP BY 1
ORDER BY 1 DESC;

-- ============================================
-- QUERY 2: Active Traders
-- ============================================

WITH trader_activity AS (
  SELECT
    DATE_TRUNC('day', evt_block_time) AS day,
    trader,
    COUNT(*) AS trades
  FROM (
    SELECT evt_block_time, "user" AS trader FROM perp_arbitra_dex."PerpEngine_evt_PositionOpened"
    UNION ALL
    SELECT evt_block_time, "user" AS trader FROM perp_arbitra_dex."PerpEngine_evt_PositionClosed"
    UNION ALL
    SELECT evt_block_time, liquidator AS trader FROM perp_arbitra_dex."LiquidationEngine_evt_LiquidationExecuted"
  ) all_trades
  WHERE evt_block_time >= NOW() - INTERVAL '30 days'
  GROUP BY 1, 2
)

SELECT
  day,
  COUNT(DISTINCT trader) AS active_traders,
  SUM(trades) AS total_trades,
  ROUND(AVG(trades), 2) AS avg_trades_per_trader
FROM trader_activity
GROUP BY 1
ORDER BY 1 DESC;

-- ============================================
-- QUERY 3: Cumulative Liquidations
-- ============================================

WITH liquidation_stats AS (
  SELECT
    DATE_TRUNC('hour', evt_block_time) AS hour,
    COUNT(*) AS liquidation_count,
    SUM(CAST(collateral AS DOUBLE) / 1e18) AS collateral_liquidated,
    SUM(CAST(fee AS DOUBLE) / 1e18) AS liquidation_fees,
    AVG(CAST(size AS DOUBLE) / 1e18) AS avg_liquidation_size
  FROM perp_arbitra_dex."LiquidationEngine_evt_LiquidationExecuted"
  WHERE evt_block_time >= NOW() - INTERVAL '7 days'
  GROUP BY 1
),

cumulative_liquidations AS (
  SELECT
    hour,
    liquidation_count,
    collateral_liquidated,
    liquidation_fees,
    avg_liquidation_size,
    SUM(liquidation_count) OVER (ORDER BY hour) AS cumulative_count,
    SUM(collateral_liquidated) OVER (ORDER BY hour) AS cumulative_collateral,
    SUM(liquidation_fees) OVER (ORDER BY hour) AS cumulative_fees
  FROM liquidation_stats
)

SELECT
  hour,
  liquidation_count,
  collateral_liquidated,
  liquidation_fees,
  avg_liquidation_size,
  cumulative_count,
  cumulative_collateral,
  cumulative_fees
FROM cumulative_liquidations
ORDER BY hour DESC;

-- ============================================
-- QUERY 4: PnL Distribution
-- ============================================

WITH position_pnl AS (
  SELECT
    p."user",
    p.evt_block_time AS open_time,
    c.evt_block_time AS close_time,
    CAST(p.size AS DOUBLE) / 1e18 AS size_usd,
    CAST(p.collateral AS DOUBLE) / 1e18 AS collateral_usd,
    CAST(c.pnl AS DOUBLE) / 1e18 AS pnl_usd,
    (CAST(c.pnl AS DOUBLE) / 1e18) / NULLIF(CAST(p.collateral AS DOUBLE) / 1e18, 0) AS pnl_percentage
  FROM perp_arbitra_dex."PerpEngine_evt_PositionOpened" p
  JOIN perp_arbitra_dex."PerpEngine_evt_PositionClosed" c
    ON p.positionId = c.positionId
  WHERE p.evt_block_time >= NOW() - INTERVAL '30 days'
    AND c.evt_block_time >= NOW() - INTERVAL '30 days'
)

SELECT
  CASE
    WHEN pnl_percentage < -0.5 THEN '< -50%'
    WHEN pnl_percentage < -0.2 THEN '-50% to -20%'
    WHEN pnl_percentage < -0.1 THEN '-20% to -10%'
    WHEN pnl_percentage < -0.05 THEN '-10% to -5%'
    WHEN pnl_percentage < 0 THEN '-5% to 0%'
    WHEN pnl_percentage < 0.05 THEN '0% to 5%'
    WHEN pnl_percentage < 0.1 THEN '5% to 10%'
    WHEN pnl_percentage < 0.2 THEN '10% to 20%'
    WHEN pnl_percentage < 0.5 THEN '20% to 50%'
    ELSE '> 50%'
  END AS pnl_bucket,
  COUNT(*) AS position_count,
  SUM(size_usd) AS total_size_usd,
  AVG(pnl_percentage) AS avg_pnl_percentage,
  MIN(pnl_percentage) AS min_pnl_percentage,
  MAX(pnl_percentage) AS max_pnl_percentage,
  STDDEV(pnl_percentage) AS stddev_pnl_percentage
FROM position_pnl
GROUP BY 1
ORDER BY 
  CASE pnl_bucket
    WHEN '< -50%' THEN 1
    WHEN '-50% to -20%' THEN 2
    WHEN '-20% to -10%' THEN 3
    WHEN '-10% to -5%' THEN 4
    WHEN '-5% to 0%' THEN 5
    WHEN '0% to 5%' THEN 6
    WHEN '5% to 10%' THEN 7
    WHEN '10% to 20%' THEN 8
    WHEN '20% to 50%' THEN 9
    ELSE 10
  END;

-- ============================================
-- QUERY 5: Liquidator Dominance
-- ============================================

WITH liquidator_stats AS (
  SELECT
    liquidator,
    COUNT(*) AS liquidation_count,
    SUM(CAST(size AS DOUBLE) / 1e18) AS total_size_liquidated,
    SUM(CAST(collateral AS DOUBLE) / 1e18) AS total_collateral_liquidated,
    SUM(CAST(fee AS DOUBLE) / 1e18) AS total_fees_earned,
    AVG(CAST(size AS DOUBLE) / 1e18) AS avg_liquidation_size
  FROM perp_arbitra_dex."LiquidationEngine_evt_LiquidationExecuted"
  WHERE evt_block_time >= NOW() - INTERVAL '7 days'
  GROUP BY 1
),

total_stats AS (
  SELECT
    SUM(liquidation_count) AS total_count,
    SUM(total_size_liquidated) AS total_size,
    SUM(total_fees_earned) AS total_fees
  FROM liquidator_stats
)

SELECT
  l.liquidator,
  l.liquidation_count,
  l.total_size_liquidated,
  l.total_fees_earned,
  l.avg_liquidation_size,
  ROUND(l.liquidation_count * 100.0 / NULLIF(t.total_count, 0), 2) AS count_dominance_percent,
  ROUND(l.total_size_liquidated * 100.0 / NULLIF(t.total_size, 0), 2) AS size_dominance_percent,
  ROUND(l.total_fees_earned * 100.0 / NULLIF(t.total_fees, 0), 2) AS fee_dominance_percent,
  RANK() OVER (ORDER BY l.liquidation_count DESC) AS rank_by_count,
  RANK() OVER (ORDER BY l.total_fees_earned DESC) AS rank_by_fees
FROM liquidator_stats l
CROSS JOIN total_stats t
ORDER BY l.liquidation_count DESC
LIMIT 20;

-- ============================================
-- QUERY 6: Market Share by Trading Volume
-- ============================================

WITH market_volume AS (
  SELECT
    marketId,
    DATE_TRUNC('day', evt_block_time) AS day,
    SUM(
      CASE 
        WHEN CAST(size AS DOUBLE) / 1e18 > 0 THEN CAST(size AS DOUBLE) / 1e18
        ELSE ABS(CAST(size AS DOUBLE) / 1e18)
      END
    ) AS volume_usd
  FROM perp_arbitra_dex."PerpEngine_evt_PositionOpened"
  WHERE evt_block_time >= NOW() - INTERVAL '30 days'
  GROUP BY 1, 2
  
  UNION ALL
  
  SELECT
    marketId,
    DATE_TRUNC('day', evt_block_time) AS day,
    SUM(
      CASE 
        WHEN CAST(size AS DOUBLE) / 1e18 > 0 THEN CAST(size AS DOUBLE) / 1e18
        ELSE ABS(CAST(size AS DOUBLE) / 1e18)
      END
    ) AS volume_usd
  FROM perp_arbitra_dex."PerpEngine_evt_PositionClosed"
  WHERE evt_block_time >= NOW() - INTERVAL '30 days'
  GROUP BY 1, 2
),

daily_totals AS (
  SELECT
    day,
    SUM(volume_usd) AS total_volume
  FROM market_volume
  GROUP BY 1
)

SELECT
  mv.marketId,
  mv.day,
  mv.volume_usd AS market_volume,
  dt.total_volume AS total_volume,
  ROUND(mv.volume_usd * 100.0 / NULLIF(dt.total_volume, 0), 2) AS market_share_percent,
  ROUND(AVG(mv.volume_usd * 100.0 / NULLIF(dt.total_volume, 0)) OVER (
    PARTITION BY mv.marketId 
    ORDER BY mv.day 
    ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
  ), 2) AS market_share_7d_ma
FROM market_volume mv
JOIN daily_totals dt ON mv.day = dt.day
ORDER BY mv.day DESC, mv.volume_usd DESC;

-- ============================================
-- QUERY 7: Protocol Revenue Breakdown
-- ============================================

WITH protocol_fees AS (
  -- Trading fees
  SELECT
    DATE_TRUNC('day', evt_block_time) AS day,
    'trading_fee' AS fee_type,
    SUM(CAST(fee AS DOUBLE) / 1e18) AS fee_amount_usd
  FROM perp_arbitra_dex."PerpEngine_evt_PositionClosed"
  WHERE evt_block_time >= NOW() - INTERVAL '30 days'
    AND CAST(fee AS DOUBLE) > 0
  GROUP BY 1, 2
  
  UNION ALL
  
  -- Liquidation fees
  SELECT
    DATE_TRUNC('day', evt_block_time) AS day,
    'liquidation_fee' AS fee_type,
    SUM(CAST(fee AS DOUBLE) / 1e18) AS fee_amount_usd
  FROM perp_arbitra_dex."LiquidationEngine_evt_LiquidationExecuted"
  WHERE evt_block_time >= NOW() - INTERVAL '30 days'
    AND CAST(fee AS DOUBLE) > 0
  GROUP BY 1, 2
  
  UNION ALL
  
  -- Funding fees
  SELECT
    DATE_TRUNC('day', evt_block_time) AS day,
    'funding_fee' AS fee_type,
    SUM(CAST(amount AS DOUBLE) / 1e18) AS fee_amount_usd
  FROM perp_arbitra_dex."AMMPool_evt_FundingPaid"
  WHERE evt_block_time >= NOW() - INTERVAL '30 days'
  GROUP BY 1, 2
)

SELECT
  day,
  fee_type,
  fee_amount_usd,
  SUM(fee_amount_usd) OVER (PARTITION BY day) AS daily_total,
  ROUND(fee_amount_usd * 100.0 / NULLIF(SUM(fee_amount_usd) OVER (PARTITION BY day), 0), 2) AS percentage_of_total,
  SUM(fee_amount_usd) OVER (ORDER BY day) AS cumulative_total
FROM protocol_fees
ORDER BY day DESC, fee_type;

-- ============================================
-- QUERY 8: Risk Metrics Dashboard
-- ============================================

WITH risk_metrics AS (
  SELECT
    DATE_TRUNC('hour', evt_block_time) AS hour,
    -- Open Interest
    (SELECT SUM(CAST(size AS DOUBLE) / 1e18) 
     FROM perp_arbitra_dex."PerpEngine_evt_PositionOpened" 
     WHERE evt_block_time <= hour AND positionId NOT IN (
       SELECT positionId FROM perp_arbitra_dex."PerpEngine_evt_PositionClosed" 
       WHERE evt_block_time <= hour
     )) AS open_interest_usd,
    
    -- At-risk positions (health factor < 1.5)
    COUNT(DISTINCT 
      CASE WHEN CAST(collateral AS DOUBLE) / 1e18 / NULLIF(CAST(size AS DOUBLE) / 1e18 * 0.1, 0) < 1.5 
           THEN positionId END
    ) AS at_risk_positions,
    
    -- Average health factor
    AVG(
      CASE WHEN CAST(collateral AS DOUBLE) / 1e18 > 0 
           THEN CAST(collateral AS DOUBLE) / 1e18 / NULLIF(CAST(size AS DOUBLE) / 1e18 * 0.1, 0) 
      END
    ) AS avg_health_factor,
    
    -- Skew (long vs short)
    SUM(
      CASE WHEN CAST(size AS DOUBLE) > 0 
           THEN CAST(size AS DOUBLE) / 1e18 
           ELSE 0 
      END
    ) AS long_oi,
    ABS(SUM(
      CASE WHEN CAST(size AS DOUBLE) < 0 
           THEN CAST(size AS DOUBLE) / 1e18 
           ELSE 0 
      END
    )) AS short_oi
    
  FROM perp_arbitra_dex."PerpEngine_evt_PositionOpened"
  WHERE evt_block_time >= NOW() - INTERVAL '7 days'
  GROUP BY 1
)

SELECT
  hour,
  open_interest_usd,
  at_risk_positions,
  avg_health_factor,
  long_oi,
  short_oi,
  CASE 
    WHEN long_oi + short_oi > 0 
    THEN (long_oi - short_oi) / (long_oi + short_oi)
    ELSE 0 
  END AS skew_ratio,
  CASE 
    WHEN avg_health_factor < 1.2 THEN 'CRITICAL'
    WHEN avg_health_factor < 1.5 THEN 'HIGH'
    WHEN avg_health_factor < 2.0 THEN 'MEDIUM'
    ELSE 'LOW'
  END AS risk_level
FROM risk_metrics
ORDER BY hour DESC;