const PHP_FORMATTER = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatPHP(amount: number): string {
  return PHP_FORMATTER.format(amount).replace('PHP', '₱').replace(/\s/g, '');
}
