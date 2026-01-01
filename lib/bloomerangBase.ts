import 'server-only';

export function getBloomerangBaseUrl() {
  const envBase = process.env.BLOOMERANG_BASE_URL || 'https://api.bloomerang.co/v2';
  return envBase.endsWith('/') ? envBase.slice(0, -1) : envBase;
}
