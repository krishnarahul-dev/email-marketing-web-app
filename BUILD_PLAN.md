# BUILD PLAN — Week 1 through Week 6

## Week 1: Infrastructure + Contact Management

### Step 1: Environment Setup
```bash
cp env.example .env
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
# Paste output into JWT_SECRET and UNSUBSCRIBE_SECRET in .env
```

### Step 2: Database
```bash
createdb emailtool
psql emailtool < backend/migrations/001_initial_schema.sql
psql emailtool -c "\dt"
# Expected: 13 tables listed
```

### Step 3: Backend
```bash
cd backend && npm install && npm run dev
curl http://localhost:3001/health
# Expected: {"status":"healthy",...}
```

### Step 4: Test Auth
```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"testpass123","name":"Admin","workspaceName":"TestCo"}'
# Expected: 201 with token
```

### Step 5: Test CSV Import
Create test.csv:
```csv
email,first_name,last_name,company
alice@test.com,Alice,Smith,WidgetCo
bob@test.com,Bob,Jones,GizmoInc
```
```bash
curl -X POST http://localhost:3001/api/contacts/import \
  -H "Authorization: Bearer <TOKEN>" -F "file=@test.csv"
# Expected: {"total":2,"imported":2,"duplicates":0,...}
```

### Step 6: SES Setup
1. Create IAM user with AmazonSESFullAccess
2. Verify sending domain in SES console
3. Create configuration set "email-tool-tracking"
4. Set SES_ACCESS_KEY_ID and SES_SECRET_ACCESS_KEY in .env
5. Update workspace:
```bash
curl -X PUT http://localhost:3001/api/auth/workspace \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"ses_from_email":"hello@yourdomain.com","ses_from_name":"Your Name"}'
```

---

## Week 2: Sequence Builder + Queue System

### Step 1: Frontend
```bash
cd frontend && npm install && npm run dev
# Open http://localhost:3000 — register account
```

### Step 2: Create Template
Use the Unlayer editor in the Templates page. Save and verify via API.

### Step 3: Create Sequence with Steps
```bash
# Create sequence
curl -X POST http://localhost:3001/api/sequences \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"name":"Cold Outreach v1"}'

# Add 3 steps (immediate, 2-day delay, 5-day delay)
curl -X POST http://localhost:3001/api/sequences/<ID>/steps \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"step_order":1,"step_type":"email","delay_days":0,"template_id":"<T_ID>"}'

curl -X POST http://localhost:3001/api/sequences/<ID>/steps \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"step_order":2,"step_type":"email","delay_days":2,"template_id":"<T_ID>"}'

curl -X POST http://localhost:3001/api/sequences/<ID>/steps \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"step_order":3,"step_type":"email","delay_days":5,"template_id":"<T_ID>"}'
```

### Step 4: Test Enrollment
```bash
curl -X PUT http://localhost:3001/api/sequences/<ID> \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"status":"active"}'

curl -X POST http://localhost:3001/api/sequences/<ID>/enroll \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"contactIds":["<CONTACT_ID>"]}'
```
Check backend logs for "Email send job completed" and "Sequence job completed".
Verify in DB: `psql emailtool -c "SELECT id,to_email,status FROM email_logs ORDER BY created_at DESC LIMIT 5;"`

---

## Week 3: Inbound Email + AI Tone Detection

### Step 1: Postmark Inbound
1. Create Postmark inbound server
2. Set webhook URL to `https://your-url/api/webhooks/inbound`
3. Test:
```bash
curl -X POST http://localhost:3001/api/webhooks/inbound \
  -H "Content-Type: application/json" \
  -d '{"From":"prospect@test.com","FromFull":{"Email":"prospect@test.com"},"Subject":"Re: Hello","TextBody":"Sounds great, lets talk next week"}'
```

### Step 2: Claude AI Tone Detection
1. Set CLAUDE_API_KEY in .env
2. Verify tone detection:
```bash
psql emailtool -c "SELECT id,from_email,detected_tone,tone_confidence FROM reply_messages;"
# Expected: detected_tone='interested', confidence~0.9
```
3. Test all 6 categories with varied payloads.

### Step 3: Conditional Branching
1. Add condition step with reply_tone type
2. Add branch child steps (interested → meeting request template)
3. Enroll contact, simulate reply, verify branch executes

---

## Week 4: Campaign Sending + Template Polish

### Step 1: Campaign E2E
1. Create campaign with template
2. Add recipients via filter or contact IDs
3. Send campaign
4. Monitor stats: `GET /api/campaigns/<ID>/stats`
5. Verify inbox delivery

### Step 2: Tracking Verification
1. Send test email to yourself
2. Open email → verify opened_at in DB
3. Click link → verify redirect + clicked_at in DB
4. Check email_events table for granular records

### Step 3: Personalization
1. Add {{first_name}}, {{company}} tokens to templates
2. Send to a contact with those fields filled
3. Verify email content is personalized (not raw tokens)

---

## Week 5: Compliance + Deliverability

### Step 1: DNS Records
```
SPF:   TXT @ v=spf1 include:amazonses.com ~all
DKIM:  CNAME records from SES verification
DMARC: TXT _dmarc v=DMARC1; p=quarantine; rua=mailto:dmarc@yourdomain.com
```
Verify: `dig TXT yourdomain.com +short`

### Step 2: Unsubscribe E2E
1. Send test email
2. Click unsubscribe link
3. Verify: contact.status='unsubscribed', suppression entry, enrollments cancelled
4. Attempt re-send → blocked by worker

### Step 3: Bounce Handling
1. Configure SES SNS → POST /api/webhooks/events
2. Send to SES simulator bounce address
3. Verify: status='bounced', suppression entry, contact status updated

### Step 4: Warm-Up
Set daily_send_limit=50 on workspace. Increase weekly per schedule.

---

## Week 6: Analytics + Production Deploy

### Step 1: Dashboard Verification
Open Dashboard page. Verify: stat cards, timeline chart, tone pie chart, activity feed.

### Step 2: Docker Build
```bash
docker compose build
docker compose up -d
curl http://localhost:3001/health
```

### Step 3: Production Deploy
1. Push images to container registry
2. Deploy to Railway/Render/EC2
3. Set all production env vars (BASE_URL, FRONTEND_URL critical)
4. Update Postmark webhook URL to production
5. Update SES SNS subscription to production

### Step 4: Final Verification
1. Register account on production
2. Import 5 test contacts
3. Create template, spam check
4. Create 2-step sequence, activate, enroll
5. Verify: emails arrive, opens track, clicks redirect, replies classify
6. Test unsubscribe E2E
7. Monitor queue health

---

## Post-Launch Checklist
- [ ] DNS records verified (SPF, DKIM, DMARC)
- [ ] SES domain verified, out of sandbox
- [ ] SES configuration set with SNS events
- [ ] Postmark inbound webhook connected
- [ ] Claude API key active
- [ ] Daily send limit per warm-up stage
- [ ] Unsubscribe tested E2E
- [ ] Bounce handling tested
- [ ] Tracking pixel + click redirect working
- [ ] Monitoring + alerting configured
- [ ] Database backups scheduled
- [ ] Redis persistence enabled
