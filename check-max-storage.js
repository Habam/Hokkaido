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

  console.log('=== Mac Studio - Max Storage Pricing ===\n');

  // Check M4 Max top config with max storage
  const configs = [
    {
      name: 'M4 Max (14-core CPU, 32-core GPU, 36GB, 512GB) - base',
      url: 'https://www.apple.com/shop/buy-mac/mac-studio/m4-max-chip-14-core-cpu-32-core-gpu-36gb-memory-512gb-storage',
    },
    {
      name: 'M4 Max (16-core CPU, 40-core GPU, 128GB, 1TB) - top M4 Max',
      url: 'https://www.apple.com/shop/buy-mac/mac-studio/m4-max-chip-16-core-cpu-40-core-gpu-128gb-memory-1tb-storage',
    },
    {
      name: 'M3 Ultra (28-core CPU, 60-core GPU, 96GB, 1TB) - base Ultra',
      url: 'https://www.apple.com/shop/buy-mac/mac-studio/m3-ultra-chip-28-core-cpu-60-core-gpu-96gb-memory-1tb-storage',
    },
  ];

  for (const config of configs) {
    console.log(`--- ${config.name} ---`);

    try {
      await page.goto(config.url, {
        waitUntil: 'networkidle',
        timeout: 60000,
      });
      await page.waitForTimeout(3000);

      // Click "Select" or the config button to enter the configurator
      const selectBtn = await page.$('button:has-text("Select"), a:has-text("Select"), button:has-text("Configure")');
      if (selectBtn) {
        await selectBtn.click();
        await page.waitForTimeout(5000);
      }

      // Extract all text to find storage options and prices
      const data = await page.evaluate(() => {
        const text = document.body.innerText;
        const lines = text.split('\n').filter(l => l.trim());

        // Find storage-related lines
        const storageLines = [];
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (/\d+\s*TB/i.test(line) || /storage/i.test(line) || /SSD/i.test(line)) {
            // Get context around this line
            const start = Math.max(0, i - 1);
            const end = Math.min(lines.length, i + 3);
            for (let j = start; j < end; j++) {
              const ctx = lines[j].trim();
              if (ctx && !storageLines.includes(ctx)) {
                storageLines.push(ctx);
              }
            }
          }
        }

        // Find all price-related text
        const priceLines = lines.filter(l => /\$[\d,]+/.test(l) && l.length < 200);

        // Look for configuration/customization options
        const configLines = lines.filter(l =>
          (/add \$/i.test(l) || /\+ \$/i.test(l) || /upgrade/i.test(l)) && l.length < 200
        );

        return {
          url: document.URL,
          title: document.title,
          storageLines,
          priceLines: priceLines.slice(0, 20),
          configLines,
          bodyLength: text.length,
        };
      });

      console.log(`URL: ${data.url}`);
      console.log(`Page: ${data.title}\n`);

      if (data.storageLines.length > 0) {
        console.log('Storage options found:');
        data.storageLines.forEach(l => console.log(`  ${l}`));
        console.log();
      }

      if (data.configLines.length > 0) {
        console.log('Upgrade pricing:');
        data.configLines.forEach(l => console.log(`  ${l}`));
        console.log();
      }

      if (data.priceLines.length > 0) {
        console.log('All prices on page:');
        data.priceLines.forEach(l => console.log(`  ${l}`));
        console.log();
      }
    } catch (e) {
      console.log(`Error: ${e.message.split('\n')[0]}\n`);
    }
  }

  // Now try the Apple Store configurator directly
  console.log('\n--- Trying Apple Store Configurator ---\n');

  // Navigate to M4 Max config page and look for customize options
  try {
    await page.goto('https://www.apple.com/shop/buy-mac/mac-studio', {
      waitUntil: 'networkidle',
      timeout: 60000,
    });
    await page.waitForTimeout(3000);

    // Find all links to individual model config pages
    const configUrls = await page.evaluate(() => {
      const links = [];
      document.querySelectorAll('a').forEach(a => {
        const href = a.href || '';
        if (href.includes('/shop/product/') || href.includes('buy-mac/mac-studio')) {
          const text = a.innerText?.trim() || '';
          if (text && (text.includes('Select') || text.includes('Customize') || text.includes('Configure'))) {
            links.push({ href, text });
          }
        }
      });
      return links;
    });

    console.log('Config/Select links found:');
    configUrls.forEach(l => console.log(`  ${l.text}: ${l.href}`));

    // Click on the first model to enter configurator
    if (configUrls.length > 0) {
      await page.goto(configUrls[0].href, {
        waitUntil: 'networkidle',
        timeout: 60000,
      });
      await page.waitForTimeout(5000);

      const configData = await page.evaluate(() => {
        const text = document.body.innerText;
        const lines = text.split('\n').filter(l => l.trim());

        // Find all storage and memory upgrade options
        const upgradeLines = [];
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (/TB|storage|SSD|memory|GB/i.test(line)) {
            const start = Math.max(0, i - 1);
            const end = Math.min(lines.length, i + 2);
            for (let j = start; j < end; j++) {
              const ctx = lines[j].trim();
              if (ctx && !upgradeLines.includes(ctx)) {
                upgradeLines.push(ctx);
              }
            }
          }
        }

        return {
          url: document.URL,
          title: document.title,
          upgradeLines: upgradeLines.slice(0, 50),
          allPrices: (text.match(/\$[\d,]+(\.\d{2})?/g) || []).filter((v, i, a) => a.indexOf(v) === i),
        };
      });

      console.log(`\nConfigurator page: ${configData.title}`);
      console.log(`URL: ${configData.url}\n`);

      if (configData.upgradeLines.length > 0) {
        console.log('Storage/Memory options:');
        configData.upgradeLines.forEach(l => console.log(`  ${l}`));
      }
      console.log('\nAll unique prices:', configData.allPrices.join(', '));
    }
  } catch (e) {
    console.log(`Error: ${e.message.split('\n')[0]}`);
  }

  await browser.close();
})();
