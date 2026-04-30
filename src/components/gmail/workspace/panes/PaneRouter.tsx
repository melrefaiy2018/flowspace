/**
 * PaneRouter — dispatches to the appropriate pane component based on item.paneKind.
 *
 * Exhaustiveness check via never-typed branch ensures compile-time coverage
 * when new PaneKind values are added.
 */
import React from 'react';
import type { PaneProps } from './types.js';
import DraftPane from './DraftPane.js';
import ReviewPane from './ReviewPane.js';
import DiscussPane from './DiscussPane.js';
import SchedulePane from './SchedulePane.js';
import FilePane from './FilePane.js';
import TasksPane from './TasksPane.js';
import SummaryPane from './SummaryPane.js';

export interface PaneRouterProps extends PaneProps {}

export default function PaneRouter(props: PaneRouterProps): React.JSX.Element {
  switch (props.item.paneKind) {
    case 'draft':
      return <DraftPane {...props} />;
    case 'review':
      return <ReviewPane {...props} />;
    case 'discuss':
      return <DiscussPane {...props} />;
    case 'schedule':
      return <SchedulePane {...props} />;
    case 'file':
      return <FilePane {...props} />;
    case 'tasks':
      return <TasksPane {...props} />;
    case 'summary':
      return <SummaryPane {...props} />;
    default: {
      // Exhaustiveness check — will cause a compile error if a new PaneKind is added
      // without updating this switch.
      const _exhaustive: never = props.item.paneKind;
      void _exhaustive;
      return <DiscussPane {...props} />;
    }
  }
}
