const functions = require('firebase-functions');
const admin = require('firebase-admin');
const sgMail = require('@sendgrid/mail');

admin.initializeApp();
const db = admin.firestore();

const SENDGRID_API_KEY = functions.config().sendgrid.key;
sgMail.setApiKey(SENDGRID_API_KEY);

exports.sendThresholdAlertEmail = functions.firestore
  .document('devices/{deviceId}')
  .onUpdate(async (change, context) => {
    const beforeData = change.before.data();
    const afterData = change.after.data();
    const deviceId = context.params.deviceId;

    // Thresholds for alerts
    const thresholds = {
      pm1: { unhealthy: 36 },
      pm25: { unhealthy: 36 },
      pm10: { unhealthy: 155 },
      aqi: { unhealthy: 151 },
      temperature: { unhealthy: 33 },
      humidity: { unhealthy: 81 },
      co: { unhealthy: 12.5 },
      no2: { unhealthy: 361 },
    };

    // Check if any parameter crossed the unhealthy threshold from below to above
    let alerts = [];

    for (const param in thresholds) {
      if (
        beforeData[param] !== undefined &&
        afterData[param] !== undefined &&
        beforeData[param] < thresholds[param].unhealthy &&
        afterData[param] >= thresholds[param].unhealthy
      ) {
        alerts.push(`${param.toUpperCase()} level is unhealthy or worse: ${afterData[param]}`);
      }
    }

    if (alerts.length === 0) {
      return null; // No alerts to send
    }

    // Get user emails who have enabled email notifications
    const usersSnapshot = await db.collection('users').where('emailSystemAlerts', '==', true).get();

    if (usersSnapshot.empty) {
      console.log('No users with email notifications enabled.');
      return null;
    }

    const emails = [];
    usersSnapshot.forEach(doc => {
      const userData = doc.data();
      if (userData.emailAddress) {
        emails.push(userData.emailAddress);
      }
    });

    if (emails.length === 0) {
      console.log('No user emails found.');
      return null;
    }

    const msg = {
      to: emails,
      from: 'no-reply@aqimonitoring.com',
      subject: `Air Quality Alert for Device ${deviceId}`,
      text: `The following parameters have exceeded unhealthy thresholds:\n\n${alerts.join('\n')}`,
      html: `<p>The following parameters have exceeded unhealthy thresholds for device ${deviceId}:</p><ul>${alerts.map(alert => `<li>${alert}</li>`).join('')}</ul>`,
    };

    try {
      await sgMail.sendMultiple(msg);
      console.log('Alert emails sent successfully.');
    } catch (error) {
      console.error('Error sending alert emails:', error);
    }

    return null;
  });
