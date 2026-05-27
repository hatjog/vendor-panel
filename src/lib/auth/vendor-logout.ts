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

const EXPIRED = 'Thu, 01 Jan 1970 00:00:00 GMT';

const buildDomainVariants = (hostname: string): Array<string | undefined> => {
  // localhost, IPs and TLD-less hostnames are not valid Domain values; only emit
  // explicit domains when the hostname has at least one dot.
  if (!hostname || hostname === 'localhost' || /^[\d.:]+$/.test(hostname) || !hostname.includes('.')) {
    return [undefined];
  }

  const variants = new Set<string | undefined>([undefined, hostname, `.${hostname}`]);
  const parts = hostname.split('.');

  if (parts.length > 2) {
    const apex = parts.slice(-2).join('.');
    variants.add(apex);
    variants.add(`.${apex}`);
  }

  return Array.from(variants);
};

const clearCookie = (name: string) => {
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  const domains = buildDomainVariants(hostname);

  for (const domain of domains) {
    const domainAttr = domain ? `; Domain=${domain}` : '';
    // Mercur 2.1.1 vendor cookies may be set with Secure; SameSite=None for cross-subdomain
    // flows or with SameSite=Lax. To delete them reliably the Set-Cookie attributes must
    // match how they were created, so we emit every realistic variant.
    document.cookie = `${name}=; expires=${EXPIRED}; path=/${domainAttr}`;
    document.cookie = `${name}=; expires=${EXPIRED}; path=/; SameSite=Lax${domainAttr}`;
    document.cookie = `${name}=; expires=${EXPIRED}; path=/; SameSite=Strict${domainAttr}`;
    document.cookie = `${name}=; expires=${EXPIRED}; path=/; SameSite=None; Secure${domainAttr}`;
  }
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
