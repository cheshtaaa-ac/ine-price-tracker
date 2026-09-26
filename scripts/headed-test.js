// Run this on YOUR OWN MACHINE (not on Render — Render has no display).
// Usage: node scripts/headed-test.js <storeProductId> <optionName>
// Example: node scripts/headed-test.js 2907 Starter
//
// This calls the exact same scrapeProduct() function your backend uses,
// just with headed: true so a real Chromium window opens and you can
// record it for the "Observable (Headed) Run" deliverable.

const { scrapeProduct } = require('../scraper');

const [, , itemId, optionLabel] = process.argv;

if (!itemId || !optionLabel) {
  console.error('Usage: node scripts/headed-test.js <storeProductId> <optionName>');
  process.exit(1);
}

(async () => {
  console.log(`Launching headed browser for item ${itemId}, option "${optionLabel}"...`);
  const result = await scrapeProduct(itemId, optionLabel, { headed: true });
  console.log('Result:', result);
})();
