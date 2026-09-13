import { shoppingSeed } from '@/data/seed';

export default function ShoppingListPage() {
  return (
    <div>
      <h1>Shopping List</h1>
      <div style={{ display: 'grid', gap: 12, marginTop: 20 }}>
        {shoppingSeed.map((item) => (
          <div key={item.id} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ textDecoration: item.checked ? 'line-through' : 'none', fontWeight: 600 }}>{item.name}</div>
              <div style={{ color: '#64748b' }}>{item.quantity} • {item.category}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 600 }}>₱{item.estimatedCost}</div>
              <div style={{ color: item.priority === 'High' ? '#dc2626' : item.priority === 'Medium' ? '#d97706' : '#15803d' }}>{item.priority}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
