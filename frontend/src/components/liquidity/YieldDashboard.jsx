import React from 'react';
import { formatUnits } from 'ethers';
import { useLiquidity } from '../../hooks/useLiquidity';

export const YieldDashboard = () => {
  const { stats, userRewards, claimRewards, isClaiming } = useLiquidity();

  return (
    <div className="yield-dashboard p-6 bg-slate-900 rounded-xl border border-slate-800">
      <h2 className="text-xl font-bold text-white mb-6">Tableau de Bord des Rendements</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="yield-stat p-4 bg-slate-800/50 rounded-lg">
          <div className="label text-xs text-slate-500 uppercase font-semibold">TVL Totale</div>
          <div className="value text-2xl font-bold text-white">
            ${Number(formatUnits(stats?.totalValueLocked || 0n, 18)).toLocaleString()}
          </div>
        </div>
        <div className="yield-stat p-4 bg-slate-800/50 rounded-lg">
          <div className="label text-xs text-slate-500 uppercase font-semibold">APY Moyen</div>
          <div className="value text-2xl font-bold text-green-400">
            {stats?.averageApy}%
          </div>
        </div>
        <div className="yield-stat p-4 bg-slate-800/50 rounded-lg">
          <div className="label text-xs text-slate-500 uppercase font-semibold">Récompenses Distribuées</div>
          <div className="value text-2xl font-bold text-blue-400">
            {formatUnits(stats?.totalRewardsDistributed || 0n, 18)} PRPB
          </div>
        </div>
      </div>

      <div className="user-rewards-section p-6 bg-blue-500/5 rounded-xl border border-blue-500/20 flex items-center justify-between">
        <div>
          <div className="text-sm text-blue-400 font-medium mb-1">Vos Récompenses à Réclamer</div>
          <div className="text-3xl font-bold text-white">
            {formatUnits(userRewards || 0n, 18)} <span className="text-lg font-normal text-slate-400">PRPB</span>
          </div>
        </div>

        <button
          onClick={claimRewards}
          disabled={isClaiming || (userRewards || 0n) === 0n}
          className="claim-btn px-8 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-600 rounded-lg font-bold transition-all text-white shadow-lg shadow-blue-500/20"
        >
          {isClaiming ? 'Réclamation...' : 'Réclamer'}
        </button>
      </div>

      <div className="historical-yield mt-8">
        <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">Historique de l'APY</h3>
        <div className="h-32 flex items-end gap-1">
          {stats?.apyHistory?.map((val, i) => (
            <div
              key={i}
              className="flex-1 bg-blue-500/30 rounded-t-sm hover:bg-blue-500 transition-colors relative group"
              style={{ height: `${val}%` }}
            >
              <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-800 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap text-white">
                {val}% APY
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
