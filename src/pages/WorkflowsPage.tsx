import { useEffect, useState } from 'react';
import { api, type DynamicToolItem } from '../services/api';
import { useChatContext } from '../context/ChatContext';
import WorkflowLibraryPage from './WorkflowLibraryPage';
import WorkflowStudioPage from './WorkflowStudioPage';

type View =
  | { type: 'library' }
  | { type: 'studio'; initialDescription?: string; editingDraft?: DynamicToolItem };

interface Props {
  /** Pre-open the Studio with a description (e.g. from chat hand-off). */
  initialHandoffDescription?: string | null;
}

export default function WorkflowsPage({ initialHandoffDescription }: Props) {
  const { pendingWorkflowEdit, setPendingWorkflowEdit } = useChatContext();
  const [view, setView] = useState<View>(
    initialHandoffDescription
      ? { type: 'studio', initialDescription: initialHandoffDescription }
      : { type: 'library' },
  );

  // Consume a pending edit handoff (e.g. from AutomationsPage "Edit" button).
  // Resolves the workflow name to its full DynamicToolItem, then opens Studio.
  useEffect(() => {
    if (!pendingWorkflowEdit) return;
    const name = pendingWorkflowEdit;
    setPendingWorkflowEdit(null);
    api.getDynamicTools()
      .then(({ tools }) => {
        const match = tools.find((t) => t.name === name);
        if (match) setView({ type: 'studio', editingDraft: match });
      })
      .catch(() => {});
  }, [pendingWorkflowEdit, setPendingWorkflowEdit]);

  if (view.type === 'studio') {
    return (
      <WorkflowStudioPage
        initialDescription={view.initialDescription}
        editingDraft={view.editingDraft}
        onBack={() => setView({ type: 'library' })}
        onSaved={() => setView({ type: 'library' })}
      />
    );
  }

  return (
    <WorkflowLibraryPage
      onTeach={(desc) => setView({ type: 'studio', initialDescription: desc })}
      onEdit={(draft) => setView({ type: 'studio', editingDraft: draft })}
    />
  );
}
