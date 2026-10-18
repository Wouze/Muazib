export function splitName(name: string) {
  const i = name.indexOf(' (');
  if (i === -1) return { en: name, ar: '' };
  return { en: name.slice(0, i), ar: name.slice(i + 2, -1) };
}

export function displayName(name: string) {
  return name.split(' (')[0];
}

export function initials(name: string) {
  return displayName(name)
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

export function humanize(key: string) {
  return key.replace(/_/g, ' ');
}

export function formatTime(iso: string) {
  const hasZone = /[zZ]|[+-]\d\d:?\d\d$/.test(iso);
  const date = new Date(hasZone ? iso : `${iso}Z`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
