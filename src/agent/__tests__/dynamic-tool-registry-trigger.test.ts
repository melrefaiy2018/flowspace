import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadDynamicTools, registerDynamicTool, getDynamicTool, resetRegistry, setFileIO, type FileIO } from '../dynamic-tool-registry.js';
import type { DynamicToolDef } from '../dynamic-tool-types.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmpDir: string;
let filePath: string;

const mockIO: FileIO = {
  exists: (p: string) => fs.existsSync(p),
  read: (p: string) => fs.readFileSync(p, 'utf-8'),
  write: (p: string, data: string) => {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, data, 'utf-8');
    fs.renameSync(tmp, p);
  },
  getFilePath: () => filePath,
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowspace-test-'));
  filePath = path.join(tmpDir, '.dynamic-tools.json');
  setFileIO(mockIO);
  resetRegistry();
});

afterEach(() => {
  setFileIO(null);
  resetRegistry();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const makeTool = (name: string, withTrigger = false): DynamicToolDef => ({
  name,
  description: `Test tool ${name}`,
  parameters: { type: 'object', properties: {} },
  steps: [{ action: 'search_emails', args: { query: 'test' } }],
  ...(withTrigger ? { trigger: { type: 'email_received' as const, enabled: true, filter: 'subject:test', intervalMinutes: 2 } } : {}),
});

describe('dynamic-tool-registry trigger persistence', () => {
  it('persists and loads the trigger field', () => {
    const tool = makeTool('trigger_wf', true);
    registerDynamicTool(tool);

    resetRegistry();
    loadDynamicTools();

    const loaded = getDynamicTool('trigger_wf');
    expect(loaded).toBeDefined();
    expect(loaded!.trigger).toEqual({
      type: 'email_received',
      enabled: true,
      filter: 'subject:test',
      intervalMinutes: 2,
    });
  });

  it('handles tool without trigger (trigger is undefined)', () => {
    const tool = makeTool('no_trigger_wf', false);
    registerDynamicTool(tool);

    resetRegistry();
    loadDynamicTools();

    const loaded = getDynamicTool('no_trigger_wf');
    expect(loaded).toBeDefined();
    expect(loaded!.trigger).toBeUndefined();
  });
});
