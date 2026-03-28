export const config = { maxDuration: 300 };

// Network name mapping to GDELT station identifiers
const NETWORK_MAP = {
  "CNN": "CNN",
  "Fox News": "FOXNEWS",
  "MSNBC": "MSNBC",
  "ABC News": "KABC",  // ABC network
  "NBC News": "KNBC"   // NBC network
};

// Extract 2-3 key search terms from a headline for GDELT querying
function extractKeyTerms(headline, category) {
  // Remove common filler words and extract meaningful terms
  const stopWords = ['the','a','an','in','on','at','to','for','of','and','or','but','with','as','by','from','that','this','is','are','was','were','has','have','had','be','been','being','will','would','could','should','may','might','must','shall'];
  
  const words = headline
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.includes(w.toLowerCase()));
  
  // Take the most meaningful 3 words
  const keyWords = words.slice(0, 3);
  
  // Add category context if helpful
  const categoryTerms = {
    'Economy': ['economy', 'economic'],
    'Healthcare': ['healthcare', 'medical'],
    'Climate': ['climate', 'temperature'],
    'Government': ['government', 'federal'],
    'Education': ['education', 'school'],
    'Housing': ['housing', 'rent'],
    'Labor': ['workers', 'wages'],
    'Environment': ['environment', 'EPA'],
  };
  
  return keyWords.join(' ');
}

// Query GDELT TV API for a specific story across networks
async function queryGDELT(searchTerms, date, network) {
  // Format date for GDELT: YYYYMMDD
  const dateObj = new Date(date);
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  const formattedDate = `${year}${month}${day}`;
  
  // GDELT TV API endpoint
  const baseUrl = 'https://api.gdeltproject.org/api/v2/tv/tv';
  const params = new URLSearchParams({
    query: searchTerms,
    mode: 'timelinevol',
    format: 'json',
    startdatetime: `${formattedDate}000000`,
    enddatetime: `${formattedDate}235959`,
    station: NETWORK_MAP[network] || network.toUpperCase().replace(' ', '')
  });
  
  const url = `${baseUrl}?${params.toString()}`;
  
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'TheRealRundown/1.0 (therealrundown.ai)' }
    });
    if (!response.ok) return { covered: false, clips: 0 };
    
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error(`GDELT non-JSON response for ${network}:`, text.slice(0, 100));
      return { covered: false, clips: 0 };
    }
    
    // Check if there are any results for this day
    const timeline = data?.timeline?.[0]?.data || [];
    const totalClips = timeline.reduce((sum, item) => sum + (item.value || 0), 0);
    
    // Consider covered if more than 1 clip mentions these terms
    return {
      covered: totalClips > 1,
      clips: totalClips
    };
    
  } catch (e) {
    console.error(`GDELT query error for ${network}:`, e.message);
    return { covered: false, clips: 0 };
  }
}

// Update Supabase with coverage data
async function updateCoverage(supabaseUrl, supabaseKey, storyId, rundownId, network, covered) {
  try {
    // Check if record exists first
    const checkRes = await fetch(
      `${supabaseUrl}/rest/v1/network_coverage?story_id=eq.${storyId}&network_name=eq.${encodeURIComponent(network)}`,
      {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`
        }
      }
    );
    
    const existing = await checkRes.json();
    
    if (existing && existing.length > 0) {
      // Update existing record
      await fetch(
        `${supabaseUrl}/rest/v1/network_coverage?story_id=eq.${storyId}&network_name=eq.${encodeURIComponent(network)}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
          },
          body: JSON.stringify({ covered })
        }
      );
    } else {
      // Insert new record
      await fetch(`${supabaseUrl}/rest/v1/network_coverage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`
        },
        body: JSON.stringify({
          story_id: storyId,
          rundown_id: rundownId,
          network_name: network,
          covered
        })
      });
    }
  } catch (e) {
    console.error(`Supabase update error:`, e.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase credentials not configured' });
  }

  try {
    // Step 1: Get today's rundown from Supabase
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    const rundownRes = await fetch(
      `${SUPABASE_URL}/rest/v1/rundowns?order=date_generated.desc&limit=1`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      }
    );

    const rundowns = await rundownRes.json();
    if (!rundowns || rundowns.length === 0) {
      return res.status(404).json({ error: 'No rundown found for today' });
    }

    const rundown = rundowns[0];
    const rundownId = rundown.id;
    const rundownDate = rundown.date;

    console.log(`Checking coverage for rundown: ${rundownDate} (${rundownId})`);

    // Step 2: Get all stories for this rundown
    const storiesRes = await fetch(
      `${SUPABASE_URL}/rest/v1/stories?rundown_id=eq.${rundownId}`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      }
    );

    const stories = await storiesRes.json();
    if (!stories || stories.length === 0) {
      return res.status(404).json({ error: 'No stories found for this rundown' });
    }

    console.log(`Found ${stories.length} stories to check`);

    const networks = ["CNN", "Fox News", "MSNBC", "ABC News", "NBC News"];
    const results = [];

    // Step 3: For each story, query GDELT for each network
    for (const story of stories) {
      const searchTerms = extractKeyTerms(story.headline, story.category);
      console.log(`Checking story #${story.rank}: "${searchTerms}"`);

      const storyCoverage = { story: story.headline, rank: story.rank, networks: {} };

      for (const network of networks) {
        // Small delay to be respectful of the free API
        await new Promise(r => setTimeout(r, 500));

        const { covered, clips } = await queryGDELT(searchTerms, rundownDate, network);
        storyCoverage.networks[network] = { covered, clips };

        // Update Supabase
        await updateCoverage(SUPABASE_URL, SUPABASE_KEY, story.id, rundownId, network, covered);

        console.log(`  ${network}: ${covered ? '✓ COVERED' : '✗ MISSED'} (${clips} clips)`);
      }

      results.push(storyCoverage);
    }

    // Step 4: Update zero_coverage_count on the rundown
    const zeroCoverageCount = results.filter(r =>
      Object.values(r.networks).every(n => !n.covered)
    ).length;

    await fetch(`${SUPABASE_URL}/rest/v1/rundowns?id=eq.${rundownId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      },
      body: JSON.stringify({ zero_coverage_count: zeroCoverageCount })
    });

    console.log(`Coverage check complete. ${zeroCoverageCount} stories missed by all networks.`);

    return res.status(200).json({
      success: true,
      date: rundownDate,
      storiesChecked: stories.length,
      zeroCoverage: zeroCoverageCount,
      results
    });

  } catch (error) {
    console.error('Coverage agent error:', error);
    return res.status(500).json({ error: error.message });
  }
}
