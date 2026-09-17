const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  
  await page.goto('http://localhost:5174/login', {waitUntil: 'networkidle0'});
  await page.type('input[type="text"]', 'admin');
  await page.type('input[type="password"]', 'admin');
  await page.click('button[type="submit"]');
  await page.waitForNavigation({waitUntil: 'networkidle0'});
  
  await page.goto('http://localhost:5174/faregas/chips?tab=productos', {waitUntil: 'networkidle0'});
  console.log('On chips page. Clicking Editar tipo...');
  
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => b.textContent.includes('Editar tipo'));
    if(btn) btn.click();
    else console.log('Button not found');
  });
  
  await new Promise(r => setTimeout(r, 3000));
  await browser.close();
})();
