/**
 * tools.ts — barrel re-export
 *
 * This file was split into three focused modules:
 *   - tool-definitions.ts  TOOL_DEFINITIONS, WRITE_TOOL_NAMES, isWriteTool()
 *   - tool-approval.ts     buildApprovalRequest(), buildBlocksFromToolResult(),
 *                          plus shared helpers: parseJson, stripHtml, headerValue,
 *                          decodeEntities, formatDate, getInboxActionsBaseUrl
 *   - tool-dispatch.ts     executeGws(), executeTool()
 *
 * All existing import sites continue to work via this re-export.
 */

export { TOOL_DEFINITIONS, WRITE_TOOL_NAMES, isWriteTool } from './tool-definitions.js';
export {
  buildApprovalRequest,
  buildBlocksFromToolResult,
  parseJson,
  stripHtml,
  headerValue,
  decodeEntities,
  formatDate,
  getInboxActionsBaseUrl,
} from './tool-approval.js';
export { executeGws, executeTool } from './tool-dispatch.js';
