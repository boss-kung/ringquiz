export const AVATAR_COLOR_KEY  = 'quiz_avatar_color_index';
export const AVATAR_EMOJI_KEY  = 'quiz_avatar_emoji';

export const AVATAR_COLORS: string[] = [
  'linear-gradient(135deg,#6366F1,#818CF8)',
  'linear-gradient(135deg,#8B5CF6,#A78BFA)',
  'linear-gradient(135deg,#14B8A6,#34D399)',
  'linear-gradient(135deg,#EC4899,#F472B6)',
  'linear-gradient(135deg,#F59E0B,#F5C74A)',
  'linear-gradient(135deg,#3B82F6,#60A5FA)',
  'linear-gradient(135deg,#10B981,#6EE7B7)',
  'linear-gradient(135deg,#EF4444,#FB923C)',
];

export function getAvatarGrad(index: number): string {
  return AVATAR_COLORS[((index % AVATAR_COLORS.length) + AVATAR_COLORS.length) % AVATAR_COLORS.length];
}

export function getInitials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

export function readStoredColorIndex(): number {
  try {
    const stored = localStorage.getItem(AVATAR_COLOR_KEY);
    const parsed = stored !== null ? parseInt(stored, 10) : NaN;
    return Number.isFinite(parsed) && parsed >= 0 && parsed < AVATAR_COLORS.length ? parsed : 0;
  } catch {
    return 0;
  }
}

export function readStoredEmoji(): string {
  try { return localStorage.getItem(AVATAR_EMOJI_KEY) ?? ''; } catch { return ''; }
}
