import { formatPHP } from '@pantry/core';
import { budgetSeed, financialBreakdown } from '@/data/seed';

export default function FinancialsPage() {
  return (
    <div>
      <h1>Financial snapshot</h1>
      <div style={{ display: 'grid', gap: 16, marginTop: 20, maxWidth: 520 }}>
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
          <div style={{ color: '#64748b' }}>Monthly budget</div>
          <div style={{ fontSize: 32, fontWeight: 700, marginTop: 8 }}>{formatPHP(budgetSeed.monthlyBudget)}</div>
        </div>

        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Spending overview</h2>
          <div style={{ display: 'grid', gap: 10 }}>
            {financialBreakdown.map((row) => (
              <div key={row.category} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{row.category}</span>
                <strong>{formatPHP(row.value)}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
