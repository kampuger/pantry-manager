import { buildDigestEmail } from './notificationDigest';

describe('buildDigestEmail', () => {
  it('uses singular wording and sorts a single item', () => {
    const result = buildDigestEmail({
      householdName: 'The Gos',
      introText: null,
      items: [{ name: 'Milk', daysUntilExpiry: 2 }],
    });
    expect(result.subject).toBe('1 item expiring soon in The Gos');
    expect(result.body).toBe('- Milk — expires in 2 days');
  });

  it('uses plural wording and sorts soonest-first', () => {
    const result = buildDigestEmail({
      householdName: 'The Gos',
      introText: null,
      items: [
        { name: 'Bread', daysUntilExpiry: 5 },
        { name: 'Milk', daysUntilExpiry: 2 },
      ],
    });
    expect(result.subject).toBe('2 items expiring soon in The Gos');
    expect(result.body).toBe('- Milk — expires in 2 days\n- Bread — expires in 5 days');
  });

  it('prepends the intro text as its own paragraph when set', () => {
    const result = buildDigestEmail({
      householdName: 'The Gos',
      introText: 'Hey team, heads up!',
      items: [{ name: 'Milk', daysUntilExpiry: 2 }],
    });
    expect(result.body).toBe('Hey team, heads up!\n\n- Milk — expires in 2 days');
  });

  it('omits the intro paragraph when null or blank', () => {
    const nullResult = buildDigestEmail({ householdName: 'H', introText: null, items: [{ name: 'A', daysUntilExpiry: 1 }] });
    expect(nullResult.body).toBe('- A — expires tomorrow');

    const blankResult = buildDigestEmail({ householdName: 'H', introText: '   ', items: [{ name: 'A', daysUntilExpiry: 1 }] });
    expect(blankResult.body).toBe('- A — expires tomorrow');
  });

  it('describes today, tomorrow, future, and already-expired days correctly', () => {
    const result = buildDigestEmail({
      householdName: 'H',
      introText: null,
      items: [
        { name: 'Today item', daysUntilExpiry: 0 },
        { name: 'Tomorrow item', daysUntilExpiry: 1 },
        { name: 'Future item', daysUntilExpiry: 3 },
        { name: 'Expired item', daysUntilExpiry: -2 },
      ],
    });
    expect(result.body).toBe(
      [
        '- Expired item — expired 2 days ago',
        '- Today item — expires today',
        '- Tomorrow item — expires tomorrow',
        '- Future item — expires in 3 days',
      ].join('\n')
    );
  });
});
