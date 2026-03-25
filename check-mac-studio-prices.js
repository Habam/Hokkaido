const { chromium } = require('playwright');

(async () => {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;

  const launchOptions = { headless: true };
  if (proxyUrl) {
    const url = new URL(proxyUrl);
    launchOptions.proxy = {
      server: `${url.protocol}//${url.hostname}:${url.port}`,
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  console.log('=== Apple Mac Studio Prices ===\n');
  console.log('Fetching from apple.com...\n');

  await page.goto('https://www.apple.com/shop/buy-mac/mac-studio', {
    waitUntil: 'networkidle',
    timeout: 60000,
  });

  await page.waitForTimeout(3000);

  // Extract all model links from the buy page
  const modelLinks = await page.evaluate(() => {
    const links = [];
    const anchors = document.querySelectorAll(
      'a[href*="/shop/buy-mac/mac-studio/"]'
    );
    anchors.forEach((a) => {
      if (a.href.includes('core-cpu') && !links.includes(a.href)) {
        links.push(a.href);
      }
    });
    return links;
  });

  console.log(`Found ${modelLinks.length} configurations:\n`);

  const results = [];

  for (const link of modelLinks) {
    try {
      await page.goto(link, {
        waitUntil: 'networkidle',
        timeout: 45000,
      });
      await page.waitForTimeout(2000);

      const info = await page.evaluate(() => {
        // Get price from JSON-LD structured data
        const scripts = document.querySelectorAll(
          'script[type="application/ld+json"]'
        );
        let price = null;
        let name = null;

        for (const s of scripts) {
          try {
            const data = JSON.parse(s.textContent);
            if (data.offers) {
              const offers = Array.isArray(data.offers)
                ? data.offers
                : [data.offers];
              for (const o of offers) {
                if (o.price) price = o.price;
                else if (o.lowPrice) price = o.lowPrice;
              }
            }
            if (data.name) name = data.name;
          } catch (e) {}
        }

        // Fallback: extract from page text
        if (!price) {
          const text = document.body.innerText;
          const matches = text.match(/\$[\d,]+(?:\.\d{2})?/g);
          if (matches) {
            const prices = matches
              .map((p) => ({
                str: p,
                val: parseFloat(p.replace(/[$,]/g, '')),
              }))
              .filter((p) => p.val >= 1000)
              .sort((a, b) => a.val - b.val);
            if (prices.length > 0) price = prices[0].str;
          }
        }

        return { price, name };
      });

      // Parse URL for human-readable config name
      const slug = link.split('/').pop().replace(/\?.*/, '');
      const configName = slug.replace(/-/g, ' ');

      const priceStr =
        typeof info.price === 'number' ? `$${info.price.toLocaleString()}` : info.price || 'N/A';

      results.push({ config: configName, price: priceStr, url: link });
      console.log(`  ${configName}`);
      console.log(`  Price: ${priceStr}\n`);
    } catch (e) {
      console.log(`  Error: ${e.message.split('\n')[0]}\n`);
    }
  }

  // Print summary table
  console.log('=== Base Configurations ===\n');
  console.log('Model'.padEnd(65) + 'Price');
  console.log('-'.repeat(75));
  for (const r of results) {
    console.log(`${r.config.padEnd(65)}${r.price}`);
  }

  // Now check storage upgrade pricing for key models
  console.log('\n=== Storage Upgrade Pricing ===\n');

  const storageConfigs = [
    {
      label: 'M4 Max (14-core CPU, 32-core GPU, 36GB) — base $1,999',
      url: 'https://www.apple.com/shop/buy-mac/mac-studio/m4-max-chip-14-core-cpu-32-core-gpu-36gb-memory-512gb-storage',
    },
    {
      label: 'M4 Max (16-core CPU, 40-core GPU, 128GB) — base $3,699',
      url: 'https://www.apple.com/shop/buy-mac/mac-studio/m4-max-chip-16-core-cpu-40-core-gpu-128gb-memory-1tb-storage',
    },
    {
      label: 'M3 Ultra (28-core CPU, 60-core GPU, 96GB) — base $3,999',
      url: 'https://www.apple.com/shop/buy-mac/mac-studio/m3-ultra-chip-28-core-cpu-60-core-gpu-96gb-memory-1tb-storage',
    },
  ];

  for (const cfg of storageConfigs) {
    try {
      await page.goto(cfg.url, {
        waitUntil: 'networkidle',
        timeout: 45000,
      });
      await page.waitForTimeout(2000);

      const storageData = await page.evaluate(() => {
        const text = document.body.innerText;
        const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

        // Find the storage section and extract options
        const options = [];
        let inStorage = false;

        for (let i = 0; i < lines.length; i++) {
          if (/^Storage\.\s*Choose/i.test(lines[i])) {
            inStorage = true;
            continue;
          }
          if (inStorage) {
            // Storage option: a line like "512GB", "1TB", etc.
            const sizeMatch = lines[i].match(/^(\d+(?:GB|TB))$/);
            if (sizeMatch) {
              const size = sizeMatch[1];
              const nextLine = lines[i + 1] || '';
              let cost = 'Included';
              if (/Included/i.test(nextLine)) {
                cost = 'Included';
              } else if (/^[+−-]\s*\$[\d,.]+/.test(nextLine)) {
                cost = nextLine;
              } else if (/See pricing/i.test(nextLine)) {
                cost = 'Requires chip change';
              }
              options.push({ size, cost });
            }
            // Stop when we hit the next section
            if (
              /^(Pro apps|Not sure|Memory|Chip)\./i.test(lines[i]) ||
              /^(Learn about|Show more)/.test(lines[i])
            ) {
              if (options.length > 0) break;
            }
          }
        }

        return options;
      });

      console.log(`${cfg.label}`);
      if (storageData.length > 0) {
        for (const opt of storageData) {
          console.log(`  ${opt.size.padEnd(8)} ${opt.cost}`);
        }
      } else {
        console.log('  Could not extract storage options');
      }
      console.log();
    } catch (e) {
      console.log(`${cfg.label}`);
      console.log(`  Error: ${e.message.split('\n')[0]}\n`);
    }
  }

  console.log(`Source: apple.com | Fetched: ${new Date().toISOString()}`);

  await browser.close();
})();
