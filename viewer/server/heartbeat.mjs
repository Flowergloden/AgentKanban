import { reportActivity } from './activity.mjs';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
try {
  const event = JSON.parse(raw);
  await reportActivity({ ...event, hook_event_name: 'SessionHeartbeat' });
} catch (error) {
  process.stderr.write(`kanban-viewer: ${error.message}\n`);
}
