export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ANTHROPIC_API_KEY = process.env.VITE_ANTHROPIC_API_KEY;

  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{
          role: 'user',
          content: `You are the editor of "The Real Rundown," an independent non-partisan news show. Search for today's top news and identify the 15 most important stories for the American public — ranked by: (1) population affected, (2) policy/legislative weight, (3) public money involved, (4) measurability, (5) long-term consequence. NOT by fear, outrage, partisan angle, celebrity, or ratings.

Tiers: stories 1-8 are Tier 1 MUST-COVER, stories 9-15 are Tier 2 SHOULD-COVER.

Return ONLY valid JSON, no markdown, no explanation:
{"date":"full date string e.g. Wednesday, March 25, 2026","stories":[{"id":1,"rank":1,"tier":1,"headline":"concise factual headline","summary":"2-3 sentence factual summary with specific details","category":"Economy|Legislation|Social Policy|Climate|Healthcare|Infrastructure|Education|Government|Environment|Housing|Labor|Foreign Policy","impact":"High|Medium","minutesNeeded":4-8,"whyItMatters":"one sentence with specific numbers when possible","rankingReason":"Ranked #N: 2-3 sentences explaining exactly why this story ranked here using the rubric — population affected, policy weight, measurability, long-term consequence.","coveredBy":[]}]}

INCLUDE: legislation, economic data, healthcare policy, environment, education, housing, labor, government accountability, foreign policy with direct US impact.
EXCLUDE: celebrity news, partisan drama, single-victim crime without systemic significance, social media controversies, fear-based stories, horse-race politics.
IMPORTANT: Only include ongoing stories if there is significant NEW data, a NEW development, or a NEW policy action TODAY. Do not repeat a story just because the underlying issue persists. Every story must have a fresh news hook from today's actual news.
Return exactly 15 stories. Ranks 1-8 are tier 1, ranks 9-15 are tier 2.`
        }]
      })
    });

    const data = await response.json();
    return res.status(200).json(data);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
