#!/usr/bin/env node
// Quick test script to verify the API is working

const http = require('http');

const API_URL = process.env.API_URL || 'http://localhost:3000';

function request(path, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: JSON.parse(body),
          });
        } catch {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Testing Context Capture API...\n');

  // Test 1: Health
  console.log('1. Testing /health...');
  const health = await request('/health');
  if (health.status === 200 && health.data.status === 'ok') {
    console.log('   ✅ Server is running');
    console.log(`   Services: Claude ${health.data.services.claude ? '✅' : '❌'}, Firecrawl ${health.data.services.firecrawl ? '✅' : '❌'}`);
  } else {
    console.log('   ❌ Server not responding');
    process.exit(1);
  }

  // Test 2: Capture
  console.log('\n2. Testing /capture...');
  const capture = await request('/capture', 'POST', {
    url: 'https://example.com/test',
    title: 'Test Page',
    content: 'This is a test capture for the Context Capture API.',
    metadata: { test: true },
    source_type: 'test',
  });
  if (capture.status === 200 && capture.data.success) {
    console.log(`   ✅ Capture saved (id: ${capture.data.id})`);
  } else {
    console.log('   ❌ Capture failed:', capture.data);
  }

  // Test 3: Stats
  console.log('\n3. Testing /stats...');
  const stats = await request('/stats');
  if (stats.status === 200) {
    console.log(`   ✅ Stats: ${stats.data.totalCaptures} captures, ${stats.data.uniqueUrls} unique URLs`);
  } else {
    console.log('   ❌ Stats failed');
  }

  // Test 4: List captures
  console.log('\n4. Testing /captures...');
  const captures = await request('/captures?limit=5');
  if (captures.status === 200) {
    console.log(`   ✅ Found ${captures.data.results.length} captures`);
  } else {
    console.log('   ❌ List failed');
  }

  // Test 5: Search
  console.log('\n5. Testing /search...');
  const search = await request('/search?q=test');
  if (search.status === 200) {
    console.log(`   ✅ Search found ${search.data.results.length} results`);
  } else {
    console.log('   ❌ Search failed');
  }

  console.log('\n✨ All basic tests passed!');
  console.log('\nTo test Claude integration:');
  console.log('  curl -X POST http://localhost:3000/ask \\\');
  console.log('    -H "Content-Type: application/json" \\\');
  console.log('    -d \'{"question": "What did I capture?"}\'');
}

runTests().catch(err => {
  console.error('\n❌ Test failed:', err.message);
  console.log('\nMake sure the server is running:');
  console.log('  cd api-server && npm start');
  process.exit(1);
});
