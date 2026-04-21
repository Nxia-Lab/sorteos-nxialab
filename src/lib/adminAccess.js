const ADMIN_EMAIL = 'nxialab@gmail.com';

export function isAllowedAdminEmail(email) {
  return String(email || '').trim().toLowerCase() === ADMIN_EMAIL;
}

export function getAdminEmail() {
  return ADMIN_EMAIL;
}
