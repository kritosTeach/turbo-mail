const crypto = require('crypto');

class TrackingService {
  static generatePixelUrl(token, campaignId) {
    const domain = process.env.TRACKING_DOMAIN || 'http://localhost:3000';
    return `${domain}/track/open/${token}?cid=${campaignId}`;
  }

  static generateClickUrl(token, targetUrl, campaignId) {
    const domain = process.env.TRACKING_DOMAIN || 'http://localhost:3000';
    const encoded = Buffer.from(targetUrl).toString('base64');
    return `${domain}/track/click/${token}?url=${encoded}&cid=${campaignId}`;
  }

  static injectTrackingPixel(html, trackingToken, campaignId) {
    const pixelUrl = this.generatePixelUrl(trackingToken, campaignId);
    const pixelTag = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none;" />`;
    return html.replace('</body>', `${pixelTag}\n</body>`);
  }

  static injectClickLinks(html, trackingToken, campaignId) {
    // Replace href attributes in anchor tags with tracked URLs
    return html.replace(/<a\s+(?:[^>]*?\s+)?href="(https?:\/\/[^"]+)"/g, (match, url) => {
      const trackedUrl = this.generateClickUrl(trackingToken, url, campaignId);
      return match.replace(url, trackedUrl);
    });
  }

  static injectTracking(html, trackingToken, campaignId) {
    let result = this.injectTrackingPixel(html, trackingToken, campaignId);
    result = this.injectClickLinks(result, trackingToken, campaignId);
    return result;
  }
}

module.exports = TrackingService;