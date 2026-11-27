export function resolveSkill<T extends {slug: string; state: string}>(
  skills: readonly T[], options?: {slug?: string | null; intent?: string}
): T | null;
