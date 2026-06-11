const fs = require('fs');

const configContent = fs.readFileSync('./website/supabase-config.js', 'utf8');
const urlMatch = configContent.match(/supabaseUrl:\s*['"]([^'"]+)['"]/);
const keyMatch = configContent.match(/supabaseAnonKey:\s*['"]([^'"]+)['"]/);

if (!urlMatch || !keyMatch) {
  console.error("Could not find Supabase URL or Anon Key");
  process.exit(1);
}

const SUPABASE_URL = urlMatch[1];
const SUPABASE_ANON_KEY = keyMatch[1];

async function run() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/clients?select=id,name`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    }
  });
  
  if (!res.ok) {
    console.error("Error:", await res.text());
  } else {
    const data = await res.json();
    console.log("Clients in DB:");
    data.forEach(c => console.log(c.id, c.name));
  }
}

run();
