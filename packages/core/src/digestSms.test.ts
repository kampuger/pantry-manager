import { buildDigestSms } from './digestSms';

const FOOTER = '. Open the app for details.';

describe('buildDigestSms', () => {
  it('lists items soonest first with short day labels', () => {
    const text = buildDigestSms({
      householdName: 'The Gos',
      items: [
        { name: 'Rice', daysUntilExpiry: 5 },
        { name: 'Milk', daysUntilExpiry: 0 },
        { name: 'Eggs', daysUntilExpiry: 2 },
      ],
    });
    expect(text).toBe('Pantry (The Gos): Milk today, Eggs in 2d, Rice in 5d' + FOOTER);
  });

  it('labels tomorrow and expired items', () => {
    const text = buildDigestSms({
      householdName: 'Home',
      items: [
        { name: 'Bread', daysUntilExpiry: -2 },
        { name: 'Yogurt', daysUntilExpiry: 1 },
      ],
    });
    expect(text).toBe('Pantry (Home): Bread expired, Yogurt tomorrow' + FOOTER);
  });

  it('keeps long digests within 160 characters and says how many were left out', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      name: `Imported gourmet item number ${i + 1}`,
      daysUntilExpiry: i,
    }));
    const text = buildDigestSms({ householdName: 'A Very Long Household Name Indeed', items });

    expect(text.length).toBeLessThanOrEqual(160);
    const more = /\+(\d+) more/.exec(text);
    expect(more).not.toBeNull();
    const shown = text.slice(text.indexOf(': ') + 2, text.indexOf(' +')).split(', ').length;
    expect(shown + Number(more![1])).toBe(30);
    expect(text.endsWith(FOOTER)).toBe(true);
  });

  it('truncates a very long household name', () => {
    const text = buildDigestSms({
      householdName: 'The Extraordinarily Long Household Name Of Doom',
      items: [{ name: 'Milk', daysUntilExpiry: 1 }],
    });
    expect(text.startsWith('Pantry (The Extraordinarily):')).toBe(true);
  });

  it('truncates a very long item name', () => {
    const text = buildDigestSms({
      householdName: 'Home',
      items: [{ name: 'x'.repeat(200), daysUntilExpiry: 1 }],
    });
    expect(text.length).toBeLessThanOrEqual(160);
  });

  it('outputs plain ASCII, stripping accents, emoji and smart punctuation', () => {
    const text = buildDigestSms({
      householdName: 'Café Ñandú',
      items: [
        { name: 'Jalapeño “hot” 🌶️', daysUntilExpiry: 1 },
        { name: 'Crème fraîche', daysUntilExpiry: 2 },
      ],
    });
    expect(/^[\x20-\x7E]+$/.test(text)).toBe(true);
    expect(text).toContain('Jalapeno "hot"');
    expect(text).toContain('Creme fraiche');
    expect(text.startsWith('Pantry (Cafe Nandu):')).toBe(true);
  });

  it('never emits characters outside the GSM-7 basic set that force a 70-character message', () => {
    const text = buildDigestSms({
      householdName: 'Home',
      items: [{ name: 'Tea `bags` [box] {x} ~ | ^ \\', daysUntilExpiry: 1 }],
    });
    expect(/[`\[\]{}~|^\\]/.test(text)).toBe(false);
  });

  it('says so plainly when nothing is expiring', () => {
    expect(buildDigestSms({ householdName: 'Home', items: [] })).toBe('Pantry (Home): nothing expiring soon.');
  });
});
