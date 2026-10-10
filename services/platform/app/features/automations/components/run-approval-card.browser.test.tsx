// The same production card/hooks/transport suite runs in Chromium: jsdom
// alone cannot prove where focus lands when the retry control unmounts.
// Keep one synthetic approvals door and one set of cross-approval assertions.
import './run-approval-card.test';
