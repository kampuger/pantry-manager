import { getFreshnessFlag, formatPHP } from '@pantry/core';
import { budgetSeed, financialBreakdown, pantrySeed, shoppingSeed } from '@/data/seed';
import { color, cardStyle, badgeStyle } from '@/lib/theme';

const maxCategoryValue = Math.max(...financialBreakdown.map((row) => row.value));

export default function DashboardPage() {
  const flaggedCount = pantrySeed.filter(
    (item) => item.status === 'flagged' || getFreshnessFlag(item.lastRestock, item.category)
  ).length;

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <header>
        <p style={{ margin: 0, color: color.mutedForeground, fontSize: 13, textTransform: 'uppercase', letterSpacing: 1.2 }}>
          Overview
        </p>
        <h1 style={{ margin: '6px 0 0' }}>Dashboard</h1>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
        {[
          { label: 'Pantry Items', value: pantrySeed.length },
          { label: 'Flagged Fresh', value: flaggedCount },
          { label: 'Shopping List', value: shoppingSeed.length },
          { label: 'Budget Left', value: formatPHP(budgetSeed.remaining) },
        ].map((card) => (
          <div key={card.label} style={{ ...cardStyle, padding: 20 }}>
            <div style={{ color: color.mutedForeground, fontSize: 13 }}>{card.label}</div>
            <div style={{ marginTop: 8, fontSize: 26, fontWeight: 700 }}>{card.value}</div>
          </div>
        ))}
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
        <div style={{ ...cardStyle, padding: 20 }}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>Pantry status</h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
            {pantrySeed.slice(0, 5).map((item) => {
              const flagged = item.status === 'flagged' || getFreshnessFlag(item.lastRestock, item.category);
              const tone = flagged ? 'destructive' : item.status === 'low' ? 'warning' : 'success';
              return (
                <li
                  key={item.id}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${color.border}`, paddingBottom: 10 }}
                >
                  <span>{item.name}</span>
                  <span style={badgeStyle(tone)}>{flagged ? 'flagged' : item.status}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div style={{ ...cardStyle, padding: 20 }}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>Budget snapshot</h2>
          <div style={{ display: 'grid', gap: 10, fontSize: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: color.mutedForeground }}>Monthly budget</span>
              <strong>{formatPHP(budgetSeed.monthlyBudget)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: color.mutedForeground }}>Spent</span>
              <strong>{formatPHP(budgetSeed.spentThisMonth)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: color.mutedForeground }}>Remaining</span>
              <strong>{formatPHP(budgetSeed.remaining)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: color.mutedForeground }}>Efficiency</span>
              <strong>{budgetSeed.pantryEfficiency}%</strong>
            </div>
          </div>
        </div>
      </section>

      <section style={{ ...cardStyle, padding: 20 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Budget by category</h2>
        <div style={{ display: 'grid', gap: 14, marginTop: 6 }}>
          {financialBreakdown.map((row) => (
            <div key={row.category}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 14 }}>
                <span>{row.category}</span>
                <span>{formatPHP(row.value)}</span>
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
      </section>
    </div>
  );
}
