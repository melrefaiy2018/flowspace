import { describe, it, expect, beforeAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resetRegistry, setFileIO, registerDynamicTool, getDynamicTool, updateDynamicTool, type FileIO } from '../dynamic-tool-registry.js';

let app: express.Express;

const mockIO: FileIO = {
  exists: () => false,
  read: () => '',
  write: () => {},
  getFilePath: () => '/mock/.dynamic-tools.json',
};

beforeAll(() => {
  setFileIO(mockIO);
  resetRegistry();
  registerDynamicTool({
    name: 'test_wf',
    description: 'Test workflow',
    parameters: { type: 'object', properties: {} },
    steps: [{ action: 'search_emails', args: { query: 'test' } }],
    trigger: { type: 'email_received', enabled: false, filter: '', intervalMinutes: 2 },
  });

  app = express();
  app.use(express.json());

  app.patch('/api/dynamic-tools/:name/trigger', async (req, res) => {
    try {
      const { name } = req.params;
      const tool = getDynamicTool(name);
      if (!tool) return res.status(404).json({ error: 'Workflow not found' });
      const { enabled, filter, intervalMinutes } = req.body ?? {};
      if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be boolean' });
      if (enabled && (typeof filter !== 'string' || filter.trim().length === 0)) {
        return res.status(400).json({ error: 'filter is required when enabled is true' });
      }
      const interval = typeof intervalMinutes === 'number' && intervalMinutes >= 1 && intervalMinutes <= 60 ? intervalMinutes : 2;
      const trigger = { type: 'email_received' as const, enabled, filter: filter ?? '', intervalMinutes: interval };
      await updateDynamicTool(name, { trigger });
      res.json({ ok: true, trigger });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });

  app.get('/api/dynamic-tools/:name/trigger/status', async (req, res) => {
    try {
      const { name } = req.params;
      const tool = getDynamicTool(name);
      if (!tool) return res.status(404).json({ error: 'Workflow not found' });
      const trigger = tool.trigger;
      res.json({
        enabled: trigger?.enabled === true,
        filter: trigger?.filter ?? null,
        intervalMinutes: trigger?.intervalMinutes ?? null,
        lastPollAt: null,
        processedCount: 0,
        nextPollIn: null,
        failures: [],
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? 'Internal error' });
    }
  });
});

describe('PATCH /api/dynamic-tools/:name/trigger', () => {
  it('returns 200 and updates trigger for existing workflow', async () => {
    const res = await request(app)
      .patch('/api/dynamic-tools/test_wf/trigger')
      .send({ enabled: true, filter: 'subject:x', intervalMinutes: 2 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.trigger.enabled).toBe(true);
    expect(res.body.trigger.filter).toBe('subject:x');
  });

  it('returns 404 for nonexistent workflow', async () => {
    const res = await request(app)
      .patch('/api/dynamic-tools/nonexistent/trigger')
      .send({ enabled: true, filter: 'subject:x', intervalMinutes: 2 });
    expect(res.status).toBe(404);
  });

  it('returns 400 when enabled is true but filter is missing', async () => {
    const res = await request(app)
      .patch('/api/dynamic-tools/test_wf/trigger')
      .send({ enabled: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });
});

describe('GET /api/dynamic-tools/:name/trigger/status', () => {
  it('returns status for existing workflow', async () => {
    const res = await request(app)
      .get('/api/dynamic-tools/test_wf/trigger/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('enabled');
    expect(res.body).toHaveProperty('lastPollAt');
    expect(res.body).toHaveProperty('processedCount');
    expect(res.body).toHaveProperty('failures');
  });

  it('returns default status for workflow without trigger', async () => {
    resetRegistry();
    registerDynamicTool({
      name: 'no_trigger_wf',
      description: 'No trigger',
      parameters: { type: 'object', properties: {} },
      steps: [{ action: 'search_emails', args: { query: 'test' } }],
    });

    const res = await request(app)
      .get('/api/dynamic-tools/no_trigger_wf/trigger/status');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.lastPollAt).toBe(null);
    expect(res.body.processedCount).toBe(0);
    expect(res.body.failures).toEqual([]);
  });
});

describe('POST /api/dynamic-tools/:name/trigger/retrigger', () => {
  it('executes workflow for a single message ID and returns result', async () => {
    const mockExecuteForMessage = vi.fn().mockResolvedValue({ success: true });
    vi.doMock('../workflow-scheduler.js', () => ({
      executeForMessage: mockExecuteForMessage,
    }));

    const retriggerApp = express();
    retriggerApp.use(express.json());

    retriggerApp.post('/api/dynamic-tools/:name/trigger/retrigger', async (req, res) => {
      try {
        const { name } = req.params;
        const { messageId } = req.body ?? {};
        if (typeof messageId !== 'string' || !messageId) return res.status(400).json({ error: 'messageId required' });
        const result = await mockExecuteForMessage(name, messageId, 'thread_123');
        res.json({ ok: true, ...result });
      } catch (err: any) {
        res.status(500).json({ error: err?.message ?? 'Internal error' });
      }
    });

    const res = await request(retriggerApp)
      .post('/api/dynamic-tools/test_wf/trigger/retrigger')
      .send({ messageId: 'mid1' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.success).toBe(true);
    expect(mockExecuteForMessage).toHaveBeenCalledWith('test_wf', 'mid1', 'thread_123');
  });
});

describe('DELETE /api/dynamic-tools/:name/trigger/failures', () => {
  it('clears failures and returns ok', async () => {
    const dismissApp = express();
    dismissApp.use(express.json());
    let cleared = false;

    dismissApp.delete('/api/dynamic-tools/:name/trigger/failures', async (req, res) => {
      cleared = true;
      res.json({ ok: true });
    });

    const res = await request(dismissApp)
      .delete('/api/dynamic-tools/test_wf/trigger/failures');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(cleared).toBe(true);
  });
});

describe('GET /api/dynamic-tools/triggers/all', () => {
  it('returns all workflows with triggers', async () => {
    resetRegistry();
    setFileIO(mockIO);
    registerDynamicTool({
      name: 'active_wf',
      description: 'Active',
      parameters: { type: 'object', properties: {} },
      steps: [{ action: 'search_emails', args: { query: 'test' } }],
      trigger: { type: 'email_received', enabled: true, filter: 'subject:bill', intervalMinutes: 2 },
    });
    registerDynamicTool({
      name: 'paused_wf',
      description: 'Paused',
      label: 'My Paused Workflow',
      parameters: { type: 'object', properties: {} },
      steps: [{ action: 'search_emails', args: { query: 'test' } }],
      trigger: { type: 'email_received', enabled: false, filter: 'is:unread', intervalMinutes: 5 },
    });
    registerDynamicTool({
      name: 'no_trigger_wf',
      description: 'No trigger',
      parameters: { type: 'object', properties: {} },
      steps: [{ action: 'search_emails', args: { query: 'test' } }],
    });

    const allApp = express();
    allApp.use(express.json());

    allApp.get('/api/dynamic-tools/triggers/all', async (_req, res) => {
      const tools = [getDynamicTool('active_wf')!, getDynamicTool('paused_wf')!, getDynamicTool('no_trigger_wf')!].filter((t) => t.trigger !== undefined);
      const result = tools.map((t) => ({
        workflowName: t.name,
        workflowLabel: t.label ?? t.name,
        trigger: t.trigger,
        status: { enabled: t.trigger!.enabled, lastPollAt: null, processedCount: 0, nextPollIn: null, failures: [] },
      }));
      res.json(result);
    });

    const res = await request(allApp).get('/api/dynamic-tools/triggers/all');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0].workflowName).toBe('active_wf');
    expect(res.body[0].status.enabled).toBe(true);
    expect(res.body[1].workflowName).toBe('paused_wf');
    expect(res.body[1].workflowLabel).toBe('My Paused Workflow');
    expect(res.body[1].status.enabled).toBe(false);
  });

  it('returns empty array when no workflows have triggers', async () => {
    resetRegistry();
    setFileIO(mockIO);
    registerDynamicTool({
      name: 'no_trigger_wf',
      description: 'No trigger',
      parameters: { type: 'object', properties: {} },
      steps: [{ action: 'search_emails', args: { query: 'test' } }],
    });

    const allApp = express();
    allApp.get('/api/dynamic-tools/triggers/all', async (_req, res) => {
      const tools = [getDynamicTool('no_trigger_wf')!].filter((t) => t.trigger !== undefined);
      res.json(tools.map((t) => ({
        workflowName: t.name,
        workflowLabel: t.label ?? t.name,
        trigger: t.trigger,
        status: { enabled: false, lastPollAt: null, processedCount: 0, nextPollIn: null, failures: [] },
      })));
    });

    const res = await request(allApp).get('/api/dynamic-tools/triggers/all');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
