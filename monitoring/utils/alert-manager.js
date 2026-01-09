class AlertManager {
    constructor() {
      this.channels = [];
      this.initializeChannels();
    }
    
    initializeChannels() {
      // Slack
      if (process.env.SLACK_WEBHOOK_URL) {
        this.channels.push({
          name: 'slack',
          send: this.sendToSlack.bind(this),
        });
      }
      
      // PagerDuty
      if (process.env.PAGERDUTY_API_KEY) {
        this.channels.push({
          name: 'pagerduty',
          send: this.sendToPagerDuty.bind(this),
        });
      }
      
      // Email
      if (process.env.EMAIL_CONFIG) {
        this.channels.push({
          name: 'email',
          send: this.sendToEmail.bind(this),
        });
      }
      
      // Discord
      if (process.env.DISCORD_WEBHOOK_URL) {
        this.channels.push({
          name: 'discord',
          send: this.sendToDiscord.bind(this),
        });
      }
    }
    
    async send(alert) {
      // Envoyer à tous les canaux configurés
      const promises = this.channels.map(channel => 
        channel.send(alert).catch(error => {
          console.error(`Failed to send alert to ${channel.name}:`, error.message);
        })
      );
      
      await Promise.allSettled(promises);
    }
    
    async sendToSlack(alert) {
      const payload = {
        text: `*${alert.severity}*: ${alert.message}`,
        attachments: [
          {
            color: this.getColorForSeverity(alert.severity),
            fields: [
              { title: 'Type', value: alert.type, short: true },
              { title: 'Market', value: alert.market || 'N/A', short: true },
              { title: 'Timestamp', value: new Date(alert.timestamp).toISOString(), short: true },
              { title: 'Alert ID', value: alert.alertId || 'N/A', short: true },
            ],
          },
        ],
      };
      
      if (alert.data) {
        payload.attachments[0].fields.push({
          title: 'Data',
          value: '```' + JSON.stringify(alert.data, null, 2) + '```',
          short: false,
        });
      }
      
      await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
    
    async sendToPagerDuty(alert) {
      const payload = {
        routing_key: process.env.PAGERDUTY_API_KEY,
        event_action: alert.severity === 'CRITICAL' ? 'trigger' : 'trigger',
        payload: {
          summary: alert.message,
          source: 'perp-arbitra-dex',
          severity: alert.severity.toLowerCase(),
          timestamp: new Date(alert.timestamp).toISOString(),
          custom_details: alert.data || {},
        },
      };
      
      await fetch('https://events.pagerduty.com/v2/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
    
    async sendToEmail(alert) {
      // Implémentation basique d'envoi d'email
      const nodemailer = require('nodemailer');
      
      const transporter = nodemailer.createTransport(
        JSON.parse(process.env.EMAIL_CONFIG)
      );
      
      await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: process.env.EMAIL_TO,
        subject: `[${alert.severity}] ${alert.type} - ${alert.message.substring(0, 50)}...`,
        text: JSON.stringify(alert, null, 2),
        html: this.formatAlertAsHtml(alert),
      });
    }
    
    async sendToDiscord(alert) {
      const payload = {
        embeds: [
          {
            title: `${alert.severity}: ${alert.type}`,
            description: alert.message,
            color: this.getColorForSeverity(alert.severity),
            timestamp: new Date(alert.timestamp).toISOString(),
            fields: [],
          },
        ],
      };
      
      if (alert.data) {
        for (const [key, value] of Object.entries(alert.data)) {
          payload.embeds[0].fields.push({
            name: key,
            value: typeof value === 'object' ? JSON.stringify(value) : String(value),
            inline: true,
          });
        }
      }
      
      await fetch(process.env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
    
    getColorForSeverity(severity) {
      const colors = {
        CRITICAL: 0xff0000, // Rouge
        HIGH: 0xff9900,     // Orange
        MEDIUM: 0xffcc00,   // Jaune
        LOW: 0x00cc00,      // Vert
        INFO: 0x0066cc,     // Bleu
      };
      
      return colors[severity] || 0x808080; // Gris par défaut
    }
    
    formatAlertAsHtml(alert) {
      return `
        <h2>${alert.severity} Alert: ${alert.type}</h2>
        <p><strong>Message:</strong> ${alert.message}</p>
        <p><strong>Timestamp:</strong> ${new Date(alert.timestamp).toISOString()}</p>
        <p><strong>Market:</strong> ${alert.market || 'N/A'}</p>
        ${alert.data ? `<pre>${JSON.stringify(alert.data, null, 2)}</pre>` : ''}
      `;
    }
  }
  
  module.exports = AlertManager;