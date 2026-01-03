const fs = require('fs');
const path = require('path');
const logFilePath = path.join(__dirname, 'user_actions.log');

function logUserAction(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    fs.appendFile(logFilePath, logMessage, (err) => {
        if (err) {
            console.error('Failed to write to user action log:', err);
        }
    });
}

module.exports = { logUserAction };