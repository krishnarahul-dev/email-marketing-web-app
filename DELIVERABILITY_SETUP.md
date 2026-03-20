# Deliverability Setup Guide

## 1. DNS Records (Mandatory Before Sending)

### SPF Record
Add this TXT record to your domain root:
```
Type:  TXT
Host:  @
Value: v=spf1 include:amazonses.com ~all
TTL:   3600
```

### DKIM Records
When you verify your domain in AWS SES, Amazon generates 3 CNAME records.
Add all 3 to your domain DNS. Example format:
```
Type:  CNAME
Host:  abc123._domainkey
Value: abc123.dkim.amazonses.com
```
Repeat for all 3 DKIM records provided by SES.

### DMARC Record
```
Type:  TXT
Host:  _dmarc
Value: v=DMARC1; p=quarantine; rua=mailto:dmarc@yourdomain.com
TTL:   3600
```

### Verification Commands
```bash
# Check SPF
dig TXT yourdomain.com +short
# Should include: "v=spf1 include:amazonses.com ~all"

# Check DKIM
dig CNAME abc123._domainkey.yourdomain.com +short
# Should return: abc123.dkim.amazonses.com

# Check DMARC
dig TXT _dmarc.yourdomain.com +short
# Should return: "v=DMARC1; p=quarantine; ..."
```

## 2. AWS SES Configuration

### Step 1: Verify Domain
1. Go to AWS SES Console > Identities > Create Identity
2. Select "Domain" and enter your sending domain
3. SES provides DNS records — add them all
4. Wait for verification (usually 24-72 hours)

### Step 2: Create Configuration Set
1. SES Console > Configuration Sets > Create
2. Name: `email-tool-tracking`
3. Add Event Destination:
   - Type: SNS Topic
   - Events: Send, Delivery, Bounce, Complaint, Open, Click
4. Create an SNS subscription pointing to:
   `https://your-backend-url/api/webhooks/events`
5. Confirm the SNS subscription (check the endpoint logs)

### Step 3: Exit SES Sandbox
By default, SES is in sandbox mode (can only send to verified emails).
1. SES Console > Account Dashboard > Request Production Access
2. Fill in use case details
3. Approval typically takes 24 hours

## 3. Domain Warm-Up Schedule

Fresh domains have zero reputation. Sending too much too fast triggers spam filters.

| Week | Daily Volume | Total/Week | Notes |
|------|-------------|------------|-------|
| 1 | 20-50 | 140-350 | Only verified engaged recipients |
| 2 | 100-200 | 700-1,400 | Monitor bounce rate closely |
| 3 | 300-500 | 2,100-3,500 | Should be < 2% bounce rate |
| 4 | 500-1,000 | 3,500-7,000 | Check DMARC reports |
| 5 | 1,000-2,000 | 7,000-14,000 | Monitor spam complaints |
| 6+ | 2,000-5,000+ | Full volume | Maintain < 0.1% complaint rate |

### Warm-Up Configuration
Set your workspace `daily_send_limit` to match the current week:
```bash
curl -X PUT http://localhost:3001/api/auth/workspace \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"daily_send_limit": 50}'
```
Increase weekly as you progress through the schedule.

### Key Metrics to Watch
- **Bounce rate**: Must stay below 5% (hard bounces). Ideal: < 2%
- **Complaint rate**: Must stay below 0.1%. Above 0.3% risks SES suspension
- **Open rate**: Healthy: 20-40%. Below 10% indicates deliverability issues

## 4. Email Content Best Practices

### Subject Lines
- Keep under 50 characters
- No ALL CAPS
- No excessive punctuation (!!!)
- Personalize with {{first_name}} when possible
- A/B test different approaches

### Body Content
- Minimum 60% text to 40% images ratio
- Always include plain-text version
- No URL shorteners (bit.ly, etc.) — use full URLs
- No JavaScript or forms in email HTML
- Include your physical mailing address in the footer
- Always include unsubscribe link (auto-injected by the platform)

### Technical
- Use responsive HTML tables (Unlayer handles this)
- Inline CSS (Unlayer handles this)
- Keep total email size under 100KB
- Test with multiple email clients before sending

## 5. Built-in Platform Protections

The platform includes these automatic protections:

| Protection | Details |
|-----------|---------|
| Spam Scorer | 11-rule content analysis before send |
| Suppression List | Auto-adds bounces, complaints, unsubscribes |
| Rate Limiter | Token-bucket at 14/sec (SES default) |
| Daily Limit | Per-workspace configurable cap |
| Bounce Handler | Hard bounces auto-suppress + cancel enrollments |
| Complaint Handler | Auto-suppress + cancel all enrollments |
| Unsubscribe | JWT-signed links, auto-processed within seconds |
| Click Safety | HMAC-signed redirect URLs prevent open redirect |
| Content Escape | Personalization tokens HTML-escaped |

## 6. Monitoring Checklist

Run these checks weekly:
- [ ] Bounce rate < 5% (check SES Dashboard)
- [ ] Complaint rate < 0.1% (check SES Reputation Dashboard)
- [ ] DMARC reports reviewed (check rua email)
- [ ] Suppression list reviewed for unexpected entries
- [ ] Domain reputation tools: Google Postmaster, Microsoft SNDS
- [ ] Test email deliverability with Mail-Tester.com score > 8/10
