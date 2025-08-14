require('dotenv').config();

const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { exec } = require('child_process');
const axios = require('axios');
const path = require('path');

const app = express();
const httpPort = 80;
const httpsPort = 443;
const dstorePath = '/dstore';
const certPath = path.join(dstorePath, 'cert');
const mainDomain = process.env.DOMAIN;
const indexPath = path.join(dstorePath, 'dstore.html');
const appsJsonPath = path.join(dstorePath, 'apps.json');
const pwaJsonPath = path.join(dstorePath, 'pwa.json');
const db_URL = 'https://db.dstore.one';

let httpServer;
let httpsServer;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create apps.json if it doesn't exist
function checkAndCreateAppsJson() {
    if (!fs.existsSync(appsJsonPath)) {
        fs.writeFileSync(appsJsonPath, JSON.stringify({}), 'utf8');
        console.log('apps.json file was created with empty content.');
    }
}

// Extract version from HTML comment
function extractVersion(contents) {
    const versionRegex = /<!-- dStore version (\d+\.\d+\.\d+) -->/;
    const match = versionRegex.exec(contents);
    return match ? match[1] : null;
}

// Check and update dstore.html if necessary
async function checkAndDownloadDstore() {
    try {
        const response = await axios.get(db_URL);
        const remoteContent = response.data;
        const remoteVersion = extractVersion(remoteContent);

        let localVersion = null;
        if (fs.existsSync(indexPath)) {
            const localContent = fs.readFileSync(indexPath, 'utf8');
            localVersion = extractVersion(localContent);
        }

        if (remoteVersion && (!localVersion || compareVersions(remoteVersion, localVersion) > 0)) {
            console.log(`New version of dStore detected: ${remoteVersion}. Updating...`);
            fs.writeFileSync(indexPath, remoteContent, 'utf8');
            console.log('dstore.html file has been updated to the latest version.');
        } else {
            console.log('Local version of dStore is up to date.');
        }
    } catch (error) {
        console.error('Error checking or downloading dstore.html:', error);
    }
}

// Compare versions
function compareVersions(v1, v2) {
    const v1parts = v1.split('.').map(Number);
    const v2parts = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(v1parts.length, v2parts.length); i++) {
        const v1part = v1parts[i] || 0;
        const v2part = v2parts[i] || 0;

        if (v1part > v2part) return 1;
        if (v1part < v2part) return -1;
    }
    return 0;
}

// HTTPS server with certificate check, start and restart
function restartHttpsServer() {
    try {
        const certDir = path.join(certPath, mainDomain);
        const keyPath = path.join(certDir, 'privkey.pem');
        const certFilePath = path.join(certDir, 'cert.pem');
        const caPath = path.join(certDir, 'chain.pem');

        if (!fs.existsSync(keyPath) || !fs.existsSync(certFilePath) || !fs.existsSync(caPath)) {
            fs.mkdirSync(certDir, { recursive: true });
            console.log(`[SSL] No complete certificate set found for ${mainDomain}, obtaining...`);
            exec(`update_certificates.sh ${mainDomain}`, (error, stdout, stderr) => {
                if (error) {
                    console.error(`[SSL] Error updating certificates: ${stderr}`);
                    return;
                }
                console.log(`[SSL] Certificates successfully obtained for ${mainDomain}`);
                setTimeout(restartHttpsServer, 1500);
            });
            return;
        }

        const privateKey = fs.readFileSync(keyPath, 'utf8');
        const certificate = fs.readFileSync(certFilePath, 'utf8');
        const ca = fs.readFileSync(caPath, 'utf8');

        const credentials = { key: privateKey, cert: certificate, ca: ca };

        if (httpsServer) {
            httpsServer.close(() => {
                httpsServer = https.createServer(credentials, app).listen(httpsPort, () => {
                    console.log(`[SSL] HTTPS server restarted on port ${httpsPort}`);
                });
            });
        } else {
            httpsServer = https.createServer(credentials, app).listen(httpsPort, () => {
                console.log(`[SSL] HTTPS server started on port ${httpsPort}`);
            });
        }
    } catch (error) {
        console.error(`[SSL] Error setting up HTTPS: ${error}`);
    }
}

// HTTP server
function startHttpServer() {
    if (httpServer) {
        console.log('HTTP server is already running.');
        return;
    }
    try {
        httpServer = http.createServer(app).listen(httpPort, () => {
            console.log(`HTTP server started on port ${httpPort}`);
        });
    } catch (error) {
        console.log(`HTTP server cannot start`);
        console.error(error);
    }
}

function stopHttpServer(callback) {
    if (httpServer) {
        httpServer.close(() => {
            console.log('HTTP server stopped.');
            callback();
        });
        httpServer = null;
    } else {
        callback();
    }
}

// Launch basic functions
checkAndDownloadDstore().then(() => {
    checkAndCreateAppsJson();
    startHttpServer();
    restartHttpsServer();
});

// Periodically check for dstore.html updates
setInterval(() => {
    checkAndDownloadDstore();
}, 12 * 60 * 60 * 1000); // every 12 hours


// Middleware: auto-generate certificates for subdomains
app.use((req, res, next) => {
    const host = req.headers.host;
    if (!host) return next();
    if (
        (host.startsWith('store.') || host.startsWith('s.') || host.startsWith('apps.') || host.startsWith('dstore.')) &&
        !checkIfDomainExists(host)
    ) {
        const certDir = path.join(certPath, host);
        const keyPath = path.join(certDir, 'privkey.pem');
        const certFilePath = path.join(certDir, 'cert.pem');
        const caPath = path.join(certDir, 'chain.pem');
        if (!fs.existsSync(keyPath) || !fs.existsSync(certFilePath) || !fs.existsSync(caPath)) {
            updateCertificates(host);
        }
    }
    next();
});

function checkIfDomainExists(domain) {
    const domainsTxtPath = path.join(dstorePath, 'domains.txt');
    const domains = fs.existsSync(domainsTxtPath) ? fs.readFileSync(domainsTxtPath, 'utf8').split('\n') : [];
    return domains.includes(domain);
}

function updateCertificates(domain) {
    stopHttpServer(() => {
        const certDir = path.join(certPath, domain);
        fs.mkdirSync(certDir, { recursive: true });
        exec(`update_certificates.sh ${domain}`, (error, stdout, stderr) => {
            setTimeout(() => {
                startHttpServer();
                if (error) {
                    console.error(`[SSL][${domain}] Error updating certificates: ${stderr}`);
                    return;
                }
                console.log(`[SSL][${domain}] Certificates updated`);
                restartHttpsServer();
            }, 10000);
        });
    });
}

// Proxy middleware for requests to /..., except root and json
app.use(async (req, res, next) => {
    const pathname = req.url.split('?')[0];
    const host = req.headers.host || "";

    if (['/apps.json', '/pwa.json'].includes(pathname)) {
        return next();
    }

    if (pathname.length > 2 && pathname !== '/') {
        try {
            const headers = { ...req.headers, host: undefined,
                Referer: req.protocol + '://' + req.get('host') + req.originalUrl
            };
            const axiosConfig = {
                method: req.method,
                url: `${db_URL}${req.url}`,
                headers,
                maxRedirects: 0,
                validateStatus: status => true,
                responseType: 'stream'
            };
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                axiosConfig.data = req.body;
            }
            const response = await axios(axiosConfig);

            // Redirect only if not db.*
            if (
                [301, 302, 307, 308].includes(response.status) &&
                response.headers.location &&
                !/^db\./i.test(host)
            ) {
                return res.redirect(response.status, response.headers.location);
            }

            res.status(response.status);
            for (let key in response.headers) {
                if (!['connection', 'content-length', 'keep-alive', 'transfer-encoding', 'upgrade'].includes(key.toLowerCase())) {
                    res.setHeader(key, response.headers[key]);
                }
            }
            response.data.pipe(res);
        } catch (error) {
            if (error.response) {
                if (
                    [301, 302, 307, 308].includes(error.response.status) &&
                    error.response.headers &&
                    error.response.headers.location &&
                    !/^db\./i.test(host)
                ) {
                    return res.redirect(error.response.status, error.response.headers.location);
                }
                res.status(error.response.status);
                if (error.response.data && typeof error.response.data.pipe === 'function') {
                    error.response.data.pipe(res);
                } else {
                    res.send(
                        typeof error.response.data === 'object'
                            ? JSON.stringify(error.response.data)
                            : (error.response.data || 'Server error')
                    );
                }
            } else {
                res.status(500).send(error.message || 'Server error');
            }
        }
    } else {
        next();
    }
});

// Middleware stub for parameters (can be removed if not needed)
app.use((req, res, next) => {
    if (Object.keys(req.query).length > 0) {
        return next();
    }
    next();
});

// Root route
app.get('/', (req, res) => {
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).redirect(db_URL);
    }
});

// /apps.json
app.get('/apps.json', (req, res) => {
    if (fs.existsSync(appsJsonPath)) {
        res.sendFile(appsJsonPath);
    } else {
        res.status(404).send('File not found');
    }
});

// /pwa.json
app.get('/pwa.json', async (req, res) => {
    if (fs.existsSync(pwaJsonPath)) {
        res.sendFile(pwaJsonPath);
    } else {
        try {
            const response = await axios.get('https://cdn.dstore.one/pwa.json');
            res.send(response.data);
        } catch (error) {
            res.status(500).send({ error: 'An error occurred while fetching data.' });
        }
    }
});
