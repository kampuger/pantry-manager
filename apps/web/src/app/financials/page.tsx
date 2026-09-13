import { formatPHP } from '@pantry/core';
import { budgetSeed, financialBreakdown } from '@/data/seed';
import { color, cardStyle } from '@/lib/theme';

const maxCategoryValue = Math.max(...financialBreakdown.map((row) => row.value));

export default function FinancialsPage() {
  const metrics = [
    { label: 'Monthly budget', value: formatPHP(budgetSeed.monthlyBudget) },
    { label: 'Spent', value: formatPHP(budgetSeed.spentThisMonth) },
    { label: 'Remaining', value: formatPHP(budgetSeed.remaining) },
    { label: 'Pantry efficiency', value: `${budgetSeed.pantryEfficiency}%` },
  ];

  return (
    <div>
      <h1>Financial snapshot</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginTop: 20, maxWidth: 720 }}>
        {metrics.map((m) => (
          <div key={m.label} style={{ ...cardStyle, padding: 20 }}>
            <div style={{ color: color.mutedForeground, fontSize: 13 }}>{m.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, marginTop: 8 }}>{m.value}</div>
          </div>
        ))}
      </div>

      <div style={{ ...cardStyle, marginTop: 20, padding: 24, maxWidth: 560 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Spending by category</h2>
        <div style={{ display: 'grid', gap: 14, marginTop: 16 }}>
          {financialBreakdown.map((row) => (
            <div key={row.category}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 14 }}>
                <span>{row.category}</span>
                <strong>{formatPHP(row.value)}</strong>
              </div>
              <div style={{ background: color.muted, borderRadius: 999, height: 8, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${(row.value / maxCategoryValue) * 100}%`,
                    background: color.primary,
                    height: '100%',
                    borderRadius: 999,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
