export function readValue(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value && typeof value === 'object' && key in (value as Record<string, unknown>)) {
      return (value as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
}

export function pickString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = readValue(source, key);
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

export function buildMemberName(member: Record<string, unknown>, fallbackId: number) {
  const fullName = pickString(member, ['fullName', 'FullName']);

  if (fullName) {
    return fullName;
  }

  const first = pickString(member, ['firstName', 'FirstName']) ?? '';
  const last = pickString(member, ['lastName', 'LastName']) ?? '';
  const joined = `${first} ${last}`.trim();

  return joined || `Constituent ${fallbackId}`;
}

export function getMemberFirstName(member: Record<string, unknown>, fallbackId: number) {
  const first = pickString(member, ['firstName', 'FirstName']);

  if (first) {
    return first;
  }

  const fullName = buildMemberName(member, fallbackId);
  const [firstPiece] = fullName.split(' ');

  return firstPiece || `Constituent ${fallbackId}`;
}
