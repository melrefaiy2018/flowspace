export function getTimeGreeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function getFirstName(name?: string | null): string {
  return name?.trim().split(/\s+/)[0]?.replace(/[.,;:!?]+$/, '') || '';
}

export function formatHeroGreeting(displayName?: string | null): string {
  const firstName = getFirstName(displayName);
  return `${getTimeGreeting()}${firstName ? ` ${firstName}` : ''}`;
}
