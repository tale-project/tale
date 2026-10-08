// The same production card/hooks/transport suite runs in Chromium: jsdom
// alone cannot prove where focus lands when the pressed action, or the
// confirmation dialog it opened, leaves the page with the decision.
import './run-in-doubt-card.test';
