// Browser stub for the 'ws' package — supabase realtime uses native WebSocket in the browser.
// This prevents Rollup from trying to bundle the Node.js ws package.
export default typeof WebSocket !== 'undefined' ? WebSocket : class {};
export const WebSocketServer = class {};
