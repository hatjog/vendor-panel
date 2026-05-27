import { queryClient } from '../query-client';

const TARGETED_VENDOR_SESSION_COOKIES = [
  'connect.sid',
  '_medusa_jwt',
  '_mercur_seller',
  '_mercur_seller_jwt',
  '_mercur_seller_refresh',
  'medusa_auth_token',
  'csrf_token',
  '_csrf'
];

const clearCookie = (name: string) => {
  const expires = 'Thu, 01 Jan 1970 00:00:00 GMT';

  document.cookie = `${name}=; expires=${expires}; path=/`;
  document.cookie = `${name}=; expires=${expires}; path=/; SameSite=Lax`;
};

export const clearVendorSessionCookies = () => {
  const currentCookies = document.cookie
    .split(';')
    .map(cookie => cookie.trim().split('=')[0])
    .filter(Boolean);

  new Set([...TARGETED_VENDOR_SESSION_COOKIES, ...currentCookies]).forEach(clearCookie);
};

export const forceVendorLogoutAndRedirect = () => {
  clearVendorSessionCookies();
  window.localStorage.removeItem('medusa_auth_token');
  queryClient.clear();
  window.location.assign('/login');
};
