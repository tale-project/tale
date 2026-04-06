# Connection Status Toast — Design Plan

## Problem
The app runs on a real-time WebSocket. When it disconnects, the UI silently stops updating. Users have no idea their data is stale. This is especially problematic for self-hosted deployments.

## Approach
Persistent toast notifications (like Supabase's pattern) — non-intrusive but clearly communicates connection issues. Uses the existing Toast component as a base.

## States to Design

### 1. Disconnected — "Connection lost. Reconnecting..."
- Warning toast (orange `triangle-alert` icon)
- Persistent — no auto-dismiss, no close button
- Shows while actively trying to reconnect
- Title: "Connection lost"
- Description: "Attempting to reconnect..."
- Optional: subtle loading/pulse indicator

### 2. Reconnected — "New data available"
- Info toast (blue `info` icon)
- Has a "Refresh" action button
- Dismissible (close button)
- Title: "New data available"
- Description: "Refresh to see the latest updates."
- Action: "Refresh" link/button inline

## Component
Create a new reusable `Components/Toast/Connection` with two variants:
- **Disconnected** (warning)
- **Reconnected** (info, with action button)

Based on existing Toast component structure (340px, 12px padding, 12px corner radius, shadow).

## Screens
Show the toast on the Chat/Conversation screen (most visible impact of stale data):
- `Pages/Chat/Conversation-Disconnected` (light + dark)
- `Pages/Chat/Conversation-Reconnected` (light + dark)

Position: bottom-center of the main content area, above the chat input — same position toasts typically appear.

## Deliverables
- 2 toast component variants (Disconnected, Reconnected)
- 4 screens (2 states x 2 themes)
