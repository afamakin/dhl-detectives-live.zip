import { getStore } from '@netlify/blobs';

const TEAMS = ['Team Cipher','Team Enigma','Team Nexus','Team Quantum','Team Apex'];
const store = getStore({ name: 'dhl-detectives-scoreboard', consistency: 'strong' });

function emptyScores(){
  return Object.fromEntries(TEAMS.map(t => [t, 0]));
}

async function load(){
  const data = await store.get('scores', { type: 'json', consistency: 'strong' });
  if (!data) return { scores: emptyScores(), questions: {}, finals: {} };
  return {
    scores: { ...emptyScores(), ...(data.scores || {}) },
    questions: data.questions || {},
    finals: data.finals || {}
  };
}

function json(body, status=200){
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

export default async (req) => {
  try {
    if (req.method === 'GET') {
      const data = await load();
      return json({ scores: data.scores });
    }

    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const body = await req.json();
    const {
      action,
      team,
      player,
      sessionId,
      type,
      question,
      points = 0
    } = body || {};

    if (!TEAMS.includes(team) || !player) {
      return json({ error: 'Invalid team or player' }, 400);
    }

    if (action === 'start') {
      const completionKey = `completion/${team}/${player}`;

      const existing = await store.get(completionKey, {
        consistency: 'strong',
        type: 'json'
      });

      const legacy = await load();
      const alreadyFinal = !!legacy.finals[`${team}|${player}`];

      if ((existing && existing.completed) || alreadyFinal) {
        return json({ completed: true }, 409);
      }

      return json({ completed: false });
    }

    if (!sessionId || !['question', 'final'].includes(type)) {
      return json({ error: 'Invalid score submission' }, 400);
    }

    const data = await load();

    if (type === 'question') {
      const key = `${team}|${player}|${question}`;

      if (!data.questions[key]) {
        data.questions[key] = true;

        if (Number(points) === 1) {
          data.scores[team] += 1;
        }
      }
    } else {
      const key = `${team}|${player}`;
      const completionKey = `completion/${team}/${player}`;

      const existingCompletion = await store.get(completionKey, {
        consistency: 'strong',
        type: 'json'
      });

      if (existingCompletion && existingCompletion.completed) {
        return json({
          error: 'Attempt already completed',
          completed: true,
          scores: data.scores
        }, 409);
      }

      if (data.finals[key]) {
        return json({
          error: 'Attempt already completed',
          completed: true,
          scores: data.scores
        }, 409);
      }

      const claimed = await store.setJSON(
        completionKey,
        {
          team,
          player,
          completedAt: new Date().toISOString(),
          completed: true
        },
        { onlyIfNew: true }
      );

      if (!claimed.modified) {
        return json({
          error: 'Attempt already completed',
          completed: true,
          scores: data.scores
        }, 409);
      }

      data.finals[key] = true;

      data.scores[team] += Math.max(
        0,
        Math.min(10, Number(points) || 0)
      );
    }

    await store.setJSON('scores', data);

    return json({ scores: data.scores });

  } catch (err) {
    console.error(err);
    return json({ error: 'Score service unavailable' }, 500);
  }
};
