/* Placeholder for the self-hosted analytics tracker (see the tag in
 * index.html). In production the web droplet's Caddy proxies /_a/* to the
 * analytics host before this static file is reachable, so real visitors get
 * the real script. Everywhere without that proxy — vite dev, vite preview,
 * the e2e webServer — this no-op answers the request instead of 404ing into
 * every visitor's console (the home smoke test asserts a clean console). */
