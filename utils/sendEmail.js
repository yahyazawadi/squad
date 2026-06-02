import nodemailer from 'nodemailer';

/**
 * Send an email using Nodemailer (with console log fallback if credentials are missing)
 * @param {Object} options - { email, subject, text, html }
 */
const sendEmail = async (options) => {
  const isSmtpConfigured = 
    process.env.SMTP_HOST && 
    process.env.SMTP_PORT && 
    process.env.SMTP_USER && 
    process.env.SMTP_PASS;

  if (isSmtpConfigured) {
    try {
      const transportConfig = {
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      };

      if (process.env.SMTP_HOST && process.env.SMTP_HOST.includes('gmail')) {
        transportConfig.service = 'gmail';
      } else {
        transportConfig.host = process.env.SMTP_HOST;
        transportConfig.port = parseInt(process.env.SMTP_PORT, 10);
        transportConfig.secure = parseInt(process.env.SMTP_PORT, 10) === 465;
      }

      // Add TLS configuration to handle local development loops safely
      transportConfig.tls = {
        rejectUnauthorized: false
      };

      const transporter = nodemailer.createTransport(transportConfig);

      const mailOptions = {
        from: `"Discord Clone" <${process.env.SMTP_USER}>`,
        to: options.email,
        subject: options.subject,
        text: options.text,
        html: options.html,
      };

      await transporter.sendMail(mailOptions);
      console.log(`[EMAIL] Successfully sent email to ${options.email} via SMTP.`);
    } catch (err) {
      console.error(`[EMAIL ERROR] Failed to send email via SMTP:`, err.message);
      console.log('Falling back to console-logging the OTP code...');
      // Fallback log
      console.log('\n🌟=================== [PRODUCTION TEST MODE] ===================🌟');
      console.log(`📧  FALLBACK EMAIL DISPATCH TO: ${options.email}`);
      console.log(`📝  SUBJECT: ${options.subject}`);
      console.log('-----------------------------------------------------------------');
      console.log(`⚡  SECURITY OTP BYPASS INJECTED:`);
      console.log(`    ${options.text}`);
      console.log('🌟==============================================================🌟\n');
    }
  } else {
    // Console log fallback for easy local testing
    console.log('\n🌟=================== [LOCAL DEVELOPMENT MODE] =================🌟');
    console.log(`📧  MOCK EMAIL DISPATCH TO: ${options.email}`);
    console.log(`📝  SUBJECT: ${options.subject}`);
    console.log('-----------------------------------------------------------------');
    console.log(`⚡  LOCAL SECURITY OTP BYPASS:`);
    console.log(`    ${options.text}`);
    console.log('🌟==============================================================🌟\n');
  }
};

export default sendEmail;
