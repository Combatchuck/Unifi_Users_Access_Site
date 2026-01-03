const nodemailer = require('nodemailer');

// Handle EMAIL_PASS - require it from .env (no fallback allowed)
const emailPass = (process.env.EMAIL_PASS || '').replace(/^['"]|['"]$/g, '');
if (!emailPass) {
    console.error('Error: EMAIL_PASS is not set. Set EMAIL_PASS in your .env (see .env.example)');
    process.exit(1);
}

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.example.com', // Use environment variable or default
    port: process.env.EMAIL_PORT || 587, // Use environment variable or default
    secure: process.env.EMAIL_SECURE === 'true', // Use environment variable for secure connection (e.g., SMTPS)
    auth: {
        user: process.env.EMAIL_USER || 'your_email@example.com', // Use environment variable or default
        pass: emailPass
    }
});

async function sendVerificationCode(email, code) {
    try {
        const result = await transporter.sendMail({
            from: process.env.EMAIL_FROM || '"User Access Portal" <noreply@gate.com>',
            to: email,
            subject: 'Your verification code',
            text: `Your verification code is: ${code}\n\nThis is an auto-generated email. Replying to this email will go to a folder that is not monitored.`,
            html: `<p>Your verification code is: <strong>${code}</strong></p><br><p><small>This is an auto-generated email. Replying to this email will go to a folder that is not monitored.</small></p>`, // Added HTML version
        });
        console.log(`✅ Verification code sent successfully to ${email}`);
    } catch (error) {
        console.error(`Failed to send email to ${email}: ${error.message}`);
        throw error;
    }
}

module.exports = { sendVerificationCode };
