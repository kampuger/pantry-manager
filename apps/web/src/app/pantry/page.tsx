import { getFreshnessFlag } from '@pantry/core';
import { pantrySeed } from '@/data/seed';

export default function PantryPage() {
  return (
    <div>
      <h1>Pantry Inventory</h1>
      <div style={{ display: 'grid', gap: 12, marginTop: 20 }}>
        {pantrySeed.map((item) => {
          const freshnessFlag = item.status === 'flagged' || getFreshnessFlag(item.lastRestock, item.category);

          return (
            <div key={item.id} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>{item.name}</strong>
                <span style={{
                  padding: '4px 8px',
                  borderRadius: 999,
                  background: freshnessFlag ? '#fee2e2' : item.status === 'low' ? '#fef3c7' : '#dcfce7',
                  color: freshnessFlag ? '#b91c1c' : item.status === 'low' ? '#92400e' : '#166534',
                  fontSize: 12,
                  textTransform: 'capitalize',
                }}>
                  {freshnessFlag ? 'flagged' : item.status}
                </span>
              </div>
              <div>{item.quantity} {item.unit}</div>
              <div>{item.location} • {item.category}</div>
              <div>Last restock: {new Date(item.lastRestock).toLocaleDateString()}</div>
              <div>Expires: {item.expiry}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
