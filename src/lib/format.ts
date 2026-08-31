export const money = (value: number | null) =>
  value === null
    ? 'Unknown'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      }).format(value);
export const number = (value: number) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: 5 }).format(value);
export const shortValue = (value: string) =>
  value.startsWith('0x') && value.length > 20
    ? `${value.slice(0, 6)}…${value.slice(-4)}`
    : value.replace(/^https?:\/\//, '').replace(/\/$/, '');

export function exportReport(report: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'footprint-report.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
