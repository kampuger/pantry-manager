import Link from 'next/link';

const NAV_ITEMS = [
  { href: '/', label: 'Home' },
  { href: '/pantry', label: 'Pantry' },
  { href: '/recipe', label: 'Recipe' },
  { href: '/shopping-list', label: 'Shop' },
  { href: '/financials', label: 'Financial' },
];

export function Sidebar() {
  return (
    <nav style={{ width: 200, borderRight: '1px solid #ddd', padding: 16 }}>
      {NAV_ITEMS.map((item) => (
        <div key={item.href} style={{ marginBottom: 12 }}>
          <Link href={item.href}>{item.label}</Link>
        </div>
      ))}
    </nav>
  );
}
