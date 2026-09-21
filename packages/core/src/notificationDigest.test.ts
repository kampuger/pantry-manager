import { buildDigestEmail, shouldMarkDigestSent } from './notificationDigest';

const NO_REPLY_NOTICE = 'This is an automated message — replies to this email are not monitored.';

describe('buildDigestEmail', () => {
  it('uses singular wording and sorts a single item', () => {
    const result = buildDigestEmail({
      householdName: 'The Gos',
      introText: null,
      items: [{ name: 'Milk', daysUntilExpiry: 2 }],
    });
    expect(result.subject).toBe('1 item expiring soon in The Gos');
    expect(result.body).toBe(`- Milk — expires in 2 days\n\n${NO_REPLY_NOTICE}`);
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
    expect(result.body).toBe(`- Milk — expires in 2 days\n- Bread — expires in 5 days\n\n${NO_REPLY_NOTICE}`);
  });

  it('prepends the intro text as its own paragraph when set', () => {
    const result = buildDigestEmail({
      householdName: 'The Gos',
      introText: 'Hey team, heads up!',
      items: [{ name: 'Milk', daysUntilExpiry: 2 }],
    });
    expect(result.body).toBe(`Hey team, heads up!\n\n- Milk — expires in 2 days\n\n${NO_REPLY_NOTICE}`);
  });

  it('omits the intro paragraph when null or blank', () => {
    const nullResult = buildDigestEmail({ householdName: 'H', introText: null, items: [{ name: 'A', daysUntilExpiry: 1 }] });
    expect(nullResult.body).toBe(`- A — expires tomorrow\n\n${NO_REPLY_NOTICE}`);

    const blankResult = buildDigestEmail({ householdName: 'H', introText: '   ', items: [{ name: 'A', daysUntilExpiry: 1 }] });
    expect(blankResult.body).toBe(`- A — expires tomorrow\n\n${NO_REPLY_NOTICE}`);
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
      ].join('\n') + `\n\n${NO_REPLY_NOTICE}`
    );
  });

  it('always includes the no-reply notice as the last paragraph, regardless of intro or item count', () => {
    const withIntro = buildDigestEmail({
      householdName: 'H',
      introText: 'Custom intro',
      items: [{ name: 'A', daysUntilExpiry: 1 }],
    });
    expect(withIntro.body.endsWith(NO_REPLY_NOTICE)).toBe(true);

    const withoutIntro = buildDigestEmail({
      householdName: 'H',
      introText: null,
      items: [{ name: 'A', daysUntilExpiry: 1 }],
    });
    expect(withoutIntro.body.endsWith(NO_REPLY_NOTICE)).toBe(true);
  });
});

describe('shouldMarkDigestSent', () => {
  it('is true when every recipient was emailed', () => {
    expect(shouldMarkDigestSent([{ ok: true }, { ok: true }])).toBe(true);
  });

  it('is true when only some recipients failed, so the ones who got it are not emailed twice', () => {
    expect(shouldMarkDigestSent([{ ok: true }, { ok: false, error: 'Resend 422' }])).toBe(true);
  });

  it('is false when every send failed, so a retry the same day is still possible', () => {
    expect(shouldMarkDigestSent([{ ok: false, error: 'Resend 401' }, { ok: false, error: 'no email on file' }])).toBe(false);
  });

  it('is false when no send was attempted', () => {
    expect(shouldMarkDigestSent([])).toBe(false);
  });
});
