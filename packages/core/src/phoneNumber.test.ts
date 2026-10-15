import { normalizePhPhoneNumber, isPhMobileE164 } from './phoneNumber';

describe('normalizePhPhoneNumber', () => {
  it.each([
    ['09171234567', '+639171234567'],
    ['9171234567', '+639171234567'],
    ['639171234567', '+639171234567'],
    ['+639171234567', '+639171234567'],
    ['+63 917 123 4567', '+639171234567'],
    ['0917-123-4567', '+639171234567'],
    ['(0917) 123 4567', '+639171234567'],
    ['  +639171234567  ', '+639171234567'],
  ])('accepts %s', (input, expected) => {
    expect(normalizePhPhoneNumber(input)).toBe(expected);
  });

  it.each([
    [''],
    ['   '],
    ['+12025550123'], // US
    ['+442071234567'], // UK
    ['+6591234567'], // Singapore
    ['+63281234567'], // Manila landline
    ['02-8123-4567'], // Manila landline, local form
    ['+63917123456'], // too short
    ['+6391712345678'], // too long
    ['0817123456'], // not a 09 mobile prefix
    ['09171234567x'], // trailing junk
    ['+639171234567 ext 5'], // extension
    ['٠٩١٧١٢٣٤٥٦٧'], // Arabic-Indic digits
    ['０９１７１２３４５６７'], // full-width digits
  ])('rejects %j', (input) => {
    expect(normalizePhPhoneNumber(input)).toBeNull();
  });
});

describe('isPhMobileE164', () => {
  it('accepts only the normalized form', () => {
    expect(isPhMobileE164('+639171234567')).toBe(true);
    expect(isPhMobileE164('09171234567')).toBe(false);
    expect(isPhMobileE164('+12025550123')).toBe(false);
    expect(isPhMobileE164('+6391712345678')).toBe(false);
  });
});
