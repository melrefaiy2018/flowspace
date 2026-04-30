export type InvocationSource = 'chat' | 'scheduler';
export type ApprovalOutcome = 'auto' | 'user_approved' | 'user_rejected' | 'pending';

export interface ToolInvocation {
  readonly id: string;
  readonly name: string;
  readonly argsHash: string;
  readonly timestamp: string;
  readonly success: boolean;
  readonly approval: ApprovalOutcome;
  readonly source: InvocationSource;
}

export interface InvocationLogFile {
  readonly version: 1;
  readonly entries: readonly ToolInvocation[];
}

export interface WorkflowProposal {
  readonly id: string;
  readonly sequence: readonly string[];
  readonly occurrences: number;
  readonly firstSeen: string;
  readonly lastSeen: string;
  readonly containsDestructive: boolean;
  readonly sampleRef: string | null;
  readonly dismissedAt: string | null;
}

export interface WorkflowProposalsFile {
  readonly version: 1;
  readonly proposals: readonly WorkflowProposal[];
}

export interface ProposalSample {
  readonly proposalId: string;
  readonly capturedAt: string;
  readonly steps: readonly {
    readonly action: string;
    readonly args: Readonly<Record<string, unknown>>;
  }[];
}

export interface ProposalSampleFile {
  readonly version: 1;
  readonly samples: Readonly<Record<string, ProposalSample>>;
}

export interface SynthesisSettings {
  readonly enabled: boolean;
  readonly minOccurrences: number;
  readonly lookBackDays: number;
  readonly maxSequenceLength: number;
  readonly dismissCooldownDays: number;
  readonly logCapEntries: number;
  readonly logRetentionDays: number;
}

export interface SynthesisSettingsFile {
  readonly version: 1;
  readonly settings: SynthesisSettings;
}

export const DEFAULT_SYNTHESIS_SETTINGS: SynthesisSettings = {
  enabled: false,
  minOccurrences: 3,
  lookBackDays: 14,
  maxSequenceLength: 5,
  dismissCooldownDays: 30,
  logCapEntries: 1000,
  logRetentionDays: 30,
};

export const SYNTHESIS_SETTINGS_RANGES = {
  minOccurrences: [2, 10],
  lookBackDays: [1, 90],
  maxSequenceLength: [2, 10],
  dismissCooldownDays: [1, 365],
  logCapEntries: [100, 10000],
  logRetentionDays: [1, 365],
} as const;
