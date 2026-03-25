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
  console.log('=== Summary ===\n');
  console.log(
    'Model'.padEnd(65) + 'Price'
  );
  console.log('-'.repeat(75));
  for (const r of results) {
    console.log(`${r.config.padEnd(65)}${r.price}`);
  }

  console.log(`\nSource: apple.com | Fetched: ${new Date().toISOString()}`);

  await browser.close();
})();
