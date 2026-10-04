// Private loopback avoids the product's localhost-only development tooling.
export const webHost = '::1';
export const browserOrigins = ['http://[::1]:43830', 'http://[::1]:43831'];
export const backendOrigin = 'http://127.0.0.1:43838';
