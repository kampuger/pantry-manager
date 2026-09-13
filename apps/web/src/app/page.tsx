import { getFreshnessFlag } from '@pantry/core';
import { budgetSeed, financialBreakdown, pantrySeed, shoppingSeed } from '@/data/seed';

export default function DashboardPage() {
  const flaggedCount = pantrySeed.filter((item) => item.status === 'flagged' || getFreshnessFlag(item.lastRestock, item.category)).length;

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <header>
        <p style={{ margin: 0, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1.2 }}>Overview</p>
        <h1 style={{ margin: '8px 0 0' }}>Dashboard</h1>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
        {[
          { label: 'Pantry Items', value: pantrySeed.length },
          { label: 'Flagged Fresh', value: flaggedCount },
          { label: 'Shopping List', value: shoppingSeed.length },
          { label: 'Budget Left', value: `₱${budgetSeed.remaining.toLocaleString()}` },
        ].map((card) => (
          <div key={card.label} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
            <div style={{ color: '#64748b', fontSize: 12 }}>{card.label}</div>
            <div style={{ marginTop: 8, fontSize: 28, fontWeight: 700 }}>{card.value}</div>
          </div>
        ))}
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Pantry status</h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
            {pantrySeed.slice(0, 5).map((item) => (
              <li key={item.id} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: 8 }}>
                <span>{item.name}</span>
                <span style={{ color: item.status === 'flagged' || getFreshnessFlag(item.lastRestock, item.category) ? '#dc2626' : item.status === 'low' ? '#d97706' : '#15803d', fontWeight: 600 }}>
                  {item.status === 'flagged' || getFreshnessFlag(item.lastRestock, item.category) ? 'flagged' : item.status}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
          <h2 style={{ marginTop: 0 }}>Budget snapshot</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            <div><strong>Monthly budget:</strong> ₱{budgetSeed.monthlyBudget.toLocaleString()}</div>
            <div><strong>Spent:</strong> ₱{budgetSeed.spentThisMonth.toLocaleString()}</div>
            <div><strong>Remaining:</strong> ₱{budgetSeed.remaining.toLocaleString()}</div>
            <div><strong>Efficiency:</strong> {budgetSeed.pantryEfficiency}%</div>
          </div>
        </div>
      </section>

      <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20 }}>
        <h2 style={{ marginTop: 0 }}>Budget by category</h2>
        <div style={{ display: 'grid', gap: 12 }}>
          {financialBreakdown.map((row) => (
            <div key={row.category}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span>{row.category}</span>
                <span>₱{row.value.toLocaleString()}</span>
              </div>
              <div style={{ background: '#e2e8f0', borderRadius: 999, height: 8, overflow: 'hidden' }}>
                <div style={{ width: `${(row.value / 920) * 100}%`, background: '#10b981', height: '100%' }} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
