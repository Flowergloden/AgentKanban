const HEARTBEAT_URL = 'http://127.0.0.1:4731/api/heartbeat';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

try {
  let cwd = '';
  try {
    const payload = JSON.parse(await readStdin());
    if (typeof payload?.cwd === 'string') cwd = payload.cwd;
  } catch {
  }
  await fetch(HEARTBEAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root: cwd }),
    signal: AbortSignal.timeout(2000),
  });
} catch {
}
