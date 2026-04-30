import type { WorkItem } from '../../../../lib/work-item.js';
import type { GmailThreadDetail } from '../../../../services/api.js';
import type { ThreadBrief } from '../../../../shared/gmail-enrichment-types.js';
import type { GmailAgentAction } from '../../../../lib/gmail-agent.js';
import type { WorkspaceTabId } from '../WorkspaceTabs.js';

export interface PaneProps {
  item: WorkItem;
  threadDetail: GmailThreadDetail | null;
  brief: ThreadBrief | null;
  briefLoading: boolean;
  /** Dispatch an agent action with chat context — used by Discuss and fallback panes. */
  onAgentAction: (action: GmailAgentAction, question?: string) => void;
  /** Called when a pane successfully completes its work (commit 6 will surface done state). */
  onComplete?: (summary: string) => void;
  /** Direct (non-chat) action handler for archive/unsubscribe. If undefined,
   *  panes fall back to routing through chat via onAgentAction. */
  onDirectAction?: (kind: 'archive' | 'unsubscribe', threadId: string) => void;
  /** Switch the active workspace tab (used by DiscussPane to navigate to Chat). */
  onSwitchTab?: (tab: WorkspaceTabId) => void;
}
