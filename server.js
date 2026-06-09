const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const axios = require('axios');
const csv = require('csv-parser');
const { Readable } = require('stream');
const fs = require('fs');

// 1. Determine Environment and Configuration dynamically based on OS
const isGitHub = !!process.env.GITHUB_ACTIONS;

const puppeteerConfig = {
    headless: true,
    bypassCSP: true, 
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--disable-extensions',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-features=MemorySaverMode',
        '--memory-pressure-off'
    ]
};

if (isGitHub) {
    puppeteerConfig.executablePath = '/usr/bin/google-chrome-stable';
} else {
    puppeteerConfig.executablePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
}

// 2. Initialize Client with production remote asset version locking
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: puppeteerConfig,
    webVersion: '2.2412.54', 
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html'
    }
});

// 3. Event Listeners for Debugging
client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('⚠️ Session expired or missing! Scan this QR code to authenticate.');
});

client.on('ready', () => {
    console.log('✅ WhatsApp Connected');

    // Send immediately on startup to test WhatsApp delivery to all recipients
    sendCafeteriaReport();

    // Start the 10:15 PM WhatsApp Scheduler
    startScheduler();

    // Start the live terminal auto-refresh loop (Every 5 minutes)
    startTerminalAutoRefresh(5);
});

client.on('auth_failure', (msg) => console.error('❌ Auth Failure:', msg));
client.on('disconnected', (reason) => console.log('⚠️ Disconnected:', reason));

// 4. Core Logic: Fetch, Process, and Log Data
async function fetchCafeteriaReport() {
    try {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);

        const year = tomorrow.getFullYear();
        const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
        const day = String(tomorrow.getDate()).padStart(2, '0');
        const targetDate = `${year}-${month}-${day}`;

        const response = await axios.get('https://sgs.trackmyschoolonline.com/inventoryCafeteriaReportView.php', { timeout: 30000 });

        const rows = [];
        await new Promise((resolve, reject) => {
            Readable.from(response.data)
                .pipe(csv())
                .on('data', (row) => rows.push(row))
                .on('end', resolve)
                .on('error', reject);
        });

        const reportData = rows.filter(r => {
            const itemDate = r['Item Date']?.trim();
            const orderStatus = r['Order Status']?.trim().toLowerCase();
            return itemDate === targetDate && orderStatus === 'completed';
        });

        if (reportData.length === 0) {
            return { msg: `📅 *Date: ${targetDate}*\n⚠️ No completed orders found for this date.`, count: 0 };
        }

        const summary = reportData.reduce((acc, curr) => {
            const item = curr['Item Name']?.trim() || 'Unknown';
            acc[item] = (acc[item] || 0) + 1;
            return acc;
        }, {});

        let msg = `📋 *XPRESS SGS VENDOR DETAILS*\n📅 *Delivery:* ${targetDate}\n\n🍔 *Item Summary*\n────────────────────\n`;
        Object.entries(summary).sort((a, b) => b[1] - a[1]).forEach(([item, qty]) => {
            msg += `🔸 ${item}: *${qty}*\n`;
        });
        msg += `────────────────────\n📦 *Total Orders:* ${reportData.length}`;

        return { msg, count: reportData.length };
    } catch (err) {
        return { msg: `❌ *Error fetching report:* ${err.message}`, count: -1 };
    }
}

// 5. Send Function (Loops through multiple numbers & resolves group link)
async function sendCafeteriaReport() {
    const targetRecipients = [
        '919447064822@c.us',
        '918157966696@c.us',
        '919656290644@c.us',
        '919446334822@c.us',
        'https://chat.whatsapp.com/JVmWL2dyJuY8I0WlqNLscI?mode=gi_t'
    ];

    console.log('🚀 Generating report for recipients...');
    const report = await fetchCafeteriaReport();

    for (const recipient of targetRecipients) {
        try {
            let targetId = recipient;

            if (recipient.includes('chat.whatsapp.com/')) {
                const inviteCode = recipient.split('chat.whatsapp.com/')[1].split('?')[0].trim();
                console.log(`🔗 Resolving group link code: ${inviteCode}`);
                targetId = await client.acceptInvite(inviteCode);
                console.log(`✅ Group ID resolved: ${targetId}`);
            }

            await client.sendMessage(targetId, report.msg);
            console.log(`✅ Message sent successfully to ${targetId} at ${new Date().toLocaleTimeString()}`);
        } catch (err) {
            console.error(`❌ Failed to send WhatsApp message to ${recipient}:`, err.message);
        }
    }

    if (process.env.GITHUB_ACTIONS) {
        console.log('🏁 Task complete. Shutting down GitHub runner instance safely.');
        setTimeout(() => process.exit(0), 5000);
    }
}

// 6. Scheduler for WhatsApp Notification
function startScheduler() {
    cron.schedule('15 22 * * *', sendCafeteriaReport, { timezone: 'Asia/Kolkata' });
    console.log('📅 WhatsApp Scheduler Active (10:15 PM IST)');
}

// Helper function to auto-refresh terminal logs
function startTerminalAutoRefresh(minutes) {
    if (process.env.GITHUB_ACTIONS) return;

    const intervalMs = minutes * 60 * 1000;
    console.log(`🔄 Terminal Auto-Refresh loop initialized. Checking every ${minutes} minutes.`);

    setInterval(async () => {
        console.log(`\n⏱️ [${new Date().toLocaleTimeString()}] Auto-refreshing data from server...`);
        const report = await fetchCafeteriaReport();
        console.log(`📊 Live Data Status -> Orders matching tomorrow: ${report.count}`);
    }, intervalMs);
}

// 7. Execution Entry with Execution Context Hold Loop
console.log('🎬 Starting WhatsApp Web initialization sequence...');

// Injecting a safe timeout delay for Cloud execution paths before initialization triggers
if (isGitHub) {
    console.log('⏳ Cloud Environment detected. Holding process for 3000ms to allow local network pipelines to settle...');
    setTimeout(() => {
        client.initialize().catch(err => {
            console.error('❌ Critical Initialization Failure:', err.message);
            process.exit(1);
        });
    }, 3000);
} else {
    client.initialize().catch(err => {
        console.error('❌ Critical Initialization Failure:', err.message);
        process.exit(1);
    });
}
