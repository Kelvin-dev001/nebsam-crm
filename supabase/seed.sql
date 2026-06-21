-- ============================================================
-- Nebsam CRM — Seed Data
-- Sprint 1
-- ============================================================

-- Fixed UUIDs for predictable references
-- Telemarketers
-- 11111111-... = Sonnie
-- 22222222-... = Janet
-- 33333333-... = Suzzie

-- ── Telemarketers ───────────────────────────────────────────
INSERT INTO telemarketers (id, full_name, email, phone) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Sonnie',  'sonnie@nebsamdigital.co.ke',  '+254711000001'),
  ('22222222-2222-2222-2222-222222222222', 'Janet',   'janet@nebsamdigital.co.ke',   '+254711000002'),
  ('33333333-3333-3333-3333-333333333333', 'Suzzie',  'suzzie@nebsamdigital.co.ke',  '+254711000003');

-- ── Leads (20) ──────────────────────────────────────────────
-- Sonnie's leads (7): leads 01–07
-- Janet's leads (7):  leads 08–14
-- Suzzie's leads (6): leads 15–20

INSERT INTO leads (
  id, phone_number, assigned_to, full_name, location, vehicle_type,
  product_interested, lead_source, funnel_stage, rag_status,
  campaign_name, whatsapp_message, created_at
) VALUES

-- Sonnie's leads
('01000000-0000-0000-0000-000000000001', '+254700111001', '11111111-1111-1111-1111-111111111111',
  'Patrick Kimani', 'Westlands, Nairobi', 'Toyota Prado',
  'Fuel Monitoring Solution', 'whatsapp_bot', 'new', 'red',
  'June 2026 Fuel Push',
  'Hello, I saw your ad about fuel monitoring. My company fleet is losing fuel and I need a solution.',
  now() - INTERVAL '1 day'),

('01000000-0000-0000-0000-000000000002', '+254700111002', '11111111-1111-1111-1111-111111111111',
  'Grace Wambui', 'Karen, Nairobi', 'Nissan X-Trail',
  'Hybrid Car Tracker', 'whatsapp_bot', 'contacted', 'amber',
  'June 2026 Tracker Push',
  'I want to track my car. My employee uses it and I want to monitor movements.',
  now() - INTERVAL '5 days'),

('01000000-0000-0000-0000-000000000003', '+254700111003', '11111111-1111-1111-1111-111111111111',
  'James Mwangi', 'Kileleshwa, Nairobi', 'Subaru Forester',
  'Vehicle Video Telematics', 'meta_ads', 'interested', 'green',
  'May 2026 Video Telematics',
  'I run a school and need cameras in our school buses. How does this work?',
  now() - INTERVAL '8 days'),

('01000000-0000-0000-0000-000000000004', '+254700111004', '11111111-1111-1111-1111-111111111111',
  'Mary Akinyi', 'Langata, Nairobi', 'Toyota Land Cruiser',
  'Hybrid Car Alarm', 'tiktok_ads', 'quote_sent', 'amber',
  'June 2026 Alarm Push',
  'My car was broken into last month. Looking for a good alarm system.',
  now() - INTERVAL '12 days'),

('01000000-0000-0000-0000-000000000005', '+254700111005', '11111111-1111-1111-1111-111111111111',
  'Peter Otieno', 'Industrial Area, Nairobi', 'Ford Ranger',
  'Fuel Monitoring Solution', 'whatsapp_bot', 'won', 'green',
  'April 2026 Fuel Push',
  'We have 10 trucks and fuel theft is a big problem. Please call me.',
  now() - INTERVAL '60 days'),

('01000000-0000-0000-0000-000000000006', '+254700111006', '11111111-1111-1111-1111-111111111111',
  'Agnes Njoroge', 'Ruaka, Nairobi', 'Mazda CX-5',
  'Recovery Tracker', 'meta_ads', 'lost', 'red',
  'May 2026 Recovery Push',
  'Just checking prices. Not sure I need this.',
  now() - INTERVAL '20 days'),

('01000000-0000-0000-0000-000000000007', '+254700111007', '11111111-1111-1111-1111-111111111111',
  'Samuel Kariuki', 'Gigiri, Nairobi', 'Mercedes G-Wagon',
  'Anti-Jammer Tracker', 'referral', 'renewal_due', 'amber',
  'Anti-Jammer 2025',
  'My friend referred me. I need the best tracker that cannot be jammed.',
  now() - INTERVAL '370 days'),

-- Janet's leads
('01000000-0000-0000-0000-000000000008', '+254700111008', '22222222-2222-2222-2222-222222222222',
  'Lucy Chebet', 'Eldoret', 'Toyota Hilux',
  'Hybrid Car Tracker', 'whatsapp_bot', 'new', 'amber',
  'June 2026 Tracker Push',
  'I am in Eldoret. Do you service outside Nairobi? I need a tracker for my vehicle.',
  now() - INTERVAL '2 days'),

('01000000-0000-0000-0000-000000000009', '+254700111009', '22222222-2222-2222-2222-222222222222',
  'David Maina', 'South B, Nairobi', 'Honda CR-V',
  'Bluetooth Tracker', 'whatsapp_bot', 'contacted', 'red',
  'June 2026 BT Push',
  'What is the monthly cost? I don''t want subscription fees.',
  now() - INTERVAL '7 days'),

('01000000-0000-0000-0000-000000000010', '+254700111010', '22222222-2222-2222-2222-222222222222',
  'Sarah Nduta', 'Lavington, Nairobi', 'Subaru Legacy',
  'Hybrid Dash Cam', 'tiktok_ads', 'interested', 'amber',
  'June 2026 DashCam Push',
  'I had an accident last year and the other driver denied fault. I want a dashcam.',
  now() - INTERVAL '9 days'),

('01000000-0000-0000-0000-000000000011', '+254700111011', '22222222-2222-2222-2222-222222222222',
  'Michael Kamau', 'Kilimani, Nairobi', 'Toyota Fortuner',
  'Fuel Monitoring Solution', 'meta_ads', 'negotiating', 'green',
  'May 2026 Fuel Push',
  'I manage a company fleet of 5 vehicles. Interested in fuel monitoring.',
  now() - INTERVAL '18 days'),

('01000000-0000-0000-0000-000000000012', '+254700111012', '22222222-2222-2222-2222-222222222222',
  'Faith Wanjiku', 'Runda, Nairobi', 'Range Rover Evoque',
  'Vehicle Video Telematics', 'referral', 'installed', 'green',
  'March 2026 Video Push',
  'A colleague recommended you. I want cameras for my car for security.',
  now() - INTERVAL '90 days'),

('01000000-0000-0000-0000-000000000013', '+254700111013', '22222222-2222-2222-2222-222222222222',
  NULL, 'Unknown', NULL,
  'Recovery Tracker', 'whatsapp_bot', 'unqualified', 'red',
  'June 2026 Recovery Push',
  'Wrong number. I didn''t send this message.',
  now() - INTERVAL '3 days'),

('01000000-0000-0000-0000-000000000014', '+254700111014', '22222222-2222-2222-2222-222222222222',
  'Diana Waweru', 'Muthaiga, Nairobi', 'Volkswagen Touareg',
  'Hybrid Car Alarm', 'whatsapp_bot', 'post_sale', 'green',
  'Jan 2026 Alarm Push',
  'I need a proper alarm. My neighbor got his car stolen last week.',
  now() - INTERVAL '150 days'),

-- Suzzie's leads
('01000000-0000-0000-0000-000000000015', '+254700111015', '33333333-3333-3333-3333-333333333333',
  'Kevin Mutua', 'Thika', 'Toyota Prado',
  'Fuel Monitoring Solution', 'meta_ads', 'new', 'red',
  'June 2026 Fuel Push',
  'I have a matatu and boda boda. Need to track fuel usage. Please advise.',
  now() - INTERVAL '1 day'),

('01000000-0000-0000-0000-000000000016', '+254700111016', '33333333-3333-3333-3333-333333333333',
  'Esther Kamau', 'Nakuru', 'Nissan Patrol',
  'Anti-Jammer Tracker', 'tiktok_ads', 'quote_sent', 'amber',
  'June 2026 Anti-Jammer',
  'I travel long distances. I need a tracker that works even if they try to jam it.',
  now() - INTERVAL '6 days'),

('01000000-0000-0000-0000-000000000017', '+254700111017', '33333333-3333-3333-3333-333333333333',
  'Robert Njuguna', 'Mombasa Road, Nairobi', 'Isuzu D-Max',
  'Hybrid Car Tracker', 'whatsapp_bot', 'won', 'green',
  'May 2026 Tracker Push',
  'I have seen your ad. I want a tracker. My truck goes to Uganda and Tanzania.',
  now() - INTERVAL '45 days'),

('01000000-0000-0000-0000-000000000018', '+254700111018', '33333333-3333-3333-3333-333333333333',
  'Caroline Gitau', 'Parklands, Nairobi', 'Toyota RAV4',
  'Vehicle Video Telematics', 'referral', 'renewed', 'green',
  'June 2025 Video Push',
  'Robert Njuguna referred me. I want the same setup he has.',
  now() - INTERVAL '380 days'),

('01000000-0000-0000-0000-000000000019', '+254700111019', '33333333-3333-3333-3333-333333333333',
  'Joseph Muturi', 'Embakasi, Nairobi', 'Honda Pilot',
  'Bluetooth Tracker', 'whatsapp_bot', 'lost', 'red',
  'June 2026 BT Push',
  'I was just curious. I already bought a tracker from another company. Not interested.',
  now() - INTERVAL '4 days'),

('01000000-0000-0000-0000-000000000020', '+254700111020', '33333333-3333-3333-3333-333333333333',
  'Vivian Atieno', 'Upperhill, Nairobi', 'BMW X5',
  'Hybrid Dash Cam', 'meta_ads', 'contacted', 'amber',
  'June 2026 DashCam Push',
  'Hi. I saw the TikTok video. How much is the dashcam for a BMW?',
  now() - INTERVAL '3 days');

-- ── Sales (4) ────────────────────────────────────────────────
-- Note: renewal_due_date is auto-calculated by trigger (installation_date + 365 days)

INSERT INTO sales (
  id, lead_id, telemarketer_id, product, sale_amount,
  installation_date, installation_location,
  sale_date, vehicle_registration, serial_number,
  subscription_type, notes
) VALUES

-- Peter Otieno (lead_05) — Fuel Monitoring, won by Sonnie
('a1000000-0000-0000-0000-000000000001',
  '01000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
  'Fuel Monitoring Solution', 45000.00,
  '2025-01-15', 'Industrial Area Depot, Nairobi',
  '2025-01-10', 'KBZ 123A', 'FMS-2025-001',
  'annual', 'Fleet of 10 trucks. Installed on lead vehicle first as pilot.'),

-- Samuel Kariuki (lead_07) — Anti-Jammer Tracker, renewal_due soon, sold by Sonnie
('a1000000-0000-0000-0000-000000000002',
  '01000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
  'Anti-Jammer Tracker', 28000.00,
  '2025-06-25', 'Gigiri, Nairobi',
  '2025-06-20', 'KDD 456B', 'AJT-2025-077',
  'annual', 'High-value vehicle. Client travels to Uganda frequently.'),

-- Faith Wanjiku (lead_12) — Video Telematics, installed, sold by Janet
('a1000000-0000-0000-0000-000000000003',
  '01000000-0000-0000-0000-000000000012', '22222222-2222-2222-2222-222222222222',
  'Vehicle Video Telematics', 85000.00,
  '2025-03-10', 'Runda, Nairobi',
  '2025-03-05', 'KDA 789C', 'VVT-2025-034',
  'annual', '4-camera setup. Front, rear, and two side cameras.'),

-- Robert Njuguna (lead_17) — Hybrid Car Tracker, won by Suzzie
('a1000000-0000-0000-0000-000000000004',
  '01000000-0000-0000-0000-000000000017', '33333333-3333-3333-3333-333333333333',
  'Hybrid Car Tracker', 35000.00,
  '2025-05-20', 'Mombasa Road, Nairobi',
  '2025-05-15', 'KBY 321D', 'HCT-2025-091',
  'annual', 'Long-haul truck. Enabled cross-border tracking for Uganda/Tanzania routes.');

-- ── Call Logs (15) ───────────────────────────────────────────
INSERT INTO call_logs (
  id, lead_id, telemarketer_id, called_at, duration_seconds,
  call_outcome, call_notes, next_followup_date, next_followup_notes,
  rag_status_after_call, funnel_stage_after_call
) VALUES

-- lead_02 Grace Wambui (1 call)
('c1000000-0000-0000-0000-000000000001',
  '01000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
  now() - INTERVAL '4 days', 185,
  'answered',
  'Client answered. She wants to track her employee who uses the car. She is interested but asked for pricing. Told her we will call back with a quote.',
  CURRENT_DATE + 2, 'Send price list and call back to discuss',
  'amber', 'contacted'),

-- lead_03 James Mwangi (2 calls)
('c1000000-0000-0000-0000-000000000002',
  '01000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
  now() - INTERVAL '7 days', 320,
  'answered',
  'First call. James runs a school with 4 buses. Very interested in video telematics for student safety. Asked about package pricing.',
  now() - INTERVAL '5 days', 'Follow up with school fleet proposal',
  'amber', 'contacted'),

('c1000000-0000-0000-0000-000000000003',
  '01000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
  now() - INTERVAL '5 days', 540,
  'answered',
  'Second call. Presented school bus telematics package. James loved the live viewing feature. Confirmed interest for all 4 buses. Will discuss with school board.',
  CURRENT_DATE + 3, 'Follow up after school board meeting on Friday',
  'green', 'interested'),

-- lead_04 Mary Akinyi (2 calls)
('c1000000-0000-0000-0000-000000000004',
  '01000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
  now() - INTERVAL '11 days', 210,
  'answered',
  'Client very worried about car security after neighbor break-in. Interested in Hybrid Alarm. Asked about installation process.',
  now() - INTERVAL '9 days', 'Send quote for Hybrid Alarm',
  'amber', 'contacted'),

('c1000000-0000-0000-0000-000000000005',
  '01000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
  now() - INTERVAL '9 days', 160,
  'answered',
  'Sent quote via WhatsApp. KES 22,000 installed. Mary said she will check with her husband and call back.',
  CURRENT_DATE + 1, 'Client reviewing quote with husband. Follow up.',
  'amber', 'quote_sent'),

-- lead_05 Peter Otieno (3 calls — won)
('c1000000-0000-0000-0000-000000000006',
  '01000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
  now() - INTERVAL '58 days', 480,
  'answered',
  'Peter manages a transport company with 10 trucks. Fuel theft is major. Wants real-time monitoring and driver alerts.',
  now() - INTERVAL '55 days', 'Prepare fleet proposal for 10 vehicles',
  'amber', 'contacted'),

('c1000000-0000-0000-0000-000000000007',
  '01000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
  now() - INTERVAL '55 days', 720,
  'answered',
  'Demo call. Showed Peter how the dashboard works on a test vehicle. He was very impressed with the fuel fill alerts. Ready to proceed.',
  now() - INTERVAL '52 days', 'Confirm order and schedule installation',
  'green', 'interested'),

('c1000000-0000-0000-0000-000000000008',
  '01000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
  now() - INTERVAL '62 days', 300,
  'answered',
  'Confirmed order for 10 units. Peter signed off on KES 45,000 for pilot vehicle. Rest of fleet to follow.',
  NULL, NULL,
  'green', 'won'),

-- lead_06 Agnes Njoroge (1 call — lost)
('c1000000-0000-0000-0000-000000000009',
  '01000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
  now() - INTERVAL '19 days', 90,
  'answered',
  'Agnes said she was just browsing and not really interested. Price too high for her budget right now.',
  NULL, NULL,
  'red', 'lost'),

-- lead_07 Samuel Kariuki — renewal coming up (1 call)
('c1000000-0000-0000-0000-000000000010',
  '01000000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
  now() - INTERVAL '5 days', 240,
  'answered',
  'Called to inform Samuel his annual renewal is due on June 25. He confirmed he wants to renew. Will send M-Pesa payment details.',
  CURRENT_DATE + 2, 'Send renewal payment instructions via WhatsApp',
  'amber', 'renewal_due'),

-- lead_09 David Maina (1 call — contacted, no answer first)
('c1000000-0000-0000-0000-000000000011',
  '01000000-0000-0000-0000-000000000009', '22222222-2222-2222-2222-222222222222',
  now() - INTERVAL '6 days', 0,
  'no_answer',
  'Called David. Phone rang but no answer. Will try again tomorrow.',
  now() - INTERVAL '5 days', 'Try calling again',
  'red', 'new'),

-- lead_10 Sarah Nduta (1 call — interested)
('c1000000-0000-0000-0000-000000000012',
  '01000000-0000-0000-0000-000000000010', '22222222-2222-2222-2222-222222222222',
  now() - INTERVAL '8 days', 350,
  'answered',
  'Sarah had an accident and the other driver denied fault. She wants front and rear dashcam. Interested in the Hybrid Dash Cam package. Sent product link.',
  now() - INTERVAL '6 days', 'Client reviewing product. Follow up.',
  'amber', 'interested'),

-- lead_11 Michael Kamau (1 call — negotiating)
('c1000000-0000-0000-0000-000000000013',
  '01000000-0000-0000-0000-000000000011', '22222222-2222-2222-2222-222222222222',
  now() - INTERVAL '15 days', 680,
  'answered',
  'Michael manages 5 company vehicles. Fleet discount negotiation. He wants KES 30k per unit (we quoted 38k). Escalating to manager for approval.',
  CURRENT_DATE + 1, 'Get manager approval on bulk discount and call back',
  'green', 'negotiating'),

-- lead_12 Faith Wanjiku (1 call — installed)
('c1000000-0000-0000-0000-000000000014',
  '01000000-0000-0000-0000-000000000012', '22222222-2222-2222-2222-222222222222',
  now() - INTERVAL '88 days', 420,
  'answered',
  'Faith confirmed installation went well. 4 cameras working perfectly. Very satisfied. Referred her brother who also has a car.',
  NULL, NULL,
  'green', 'installed'),

-- lead_16 Esther Kamau (1 call — quote_sent)
('c1000000-0000-0000-0000-000000000015',
  '01000000-0000-0000-0000-000000000016', '33333333-3333-3333-3333-333333333333',
  now() - INTERVAL '5 days', 270,
  'answered',
  'Esther travels Nairobi to Nakuru weekly. Very concerned about carjacking. Loves the Anti-Jammer feature. Sent quote for KES 28,000.',
  CURRENT_DATE + 6, 'Follow up on quote. She said she gets paid on Friday.',
  'amber', 'quote_sent');

-- ── Follow-up Schedule (6) ───────────────────────────────────
INSERT INTO followup_schedule (
  id, lead_id, sale_id, telemarketer_id,
  followup_type, scheduled_date, notes, status, completed_at
) VALUES

-- lead_03 James Mwangi — pending pre-sale (school board meeting)
('f1000000-0000-0000-0000-000000000001',
  '01000000-0000-0000-0000-000000000003', NULL, '11111111-1111-1111-1111-111111111111',
  'pre_sale', CURRENT_DATE + 3,
  'James presenting to school board on Friday. Call after to get decision.',
  'pending', NULL),

-- lead_04 Mary Akinyi — pending pre-sale (reviewing quote)
('f1000000-0000-0000-0000-000000000002',
  '01000000-0000-0000-0000-000000000004', NULL, '11111111-1111-1111-1111-111111111111',
  'pre_sale', CURRENT_DATE + 1,
  'Mary reviewing alarm quote with husband. Call back tomorrow.',
  'pending', NULL),

-- lead_07 Samuel Kariuki — post-sale renewal
('f1000000-0000-0000-0000-000000000003',
  '01000000-0000-0000-0000-000000000007',
  'a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
  'post_sale_renewal', CURRENT_DATE + 2,
  'Anti-Jammer renewal due June 25. Send M-Pesa payment link.',
  'pending', NULL),

-- lead_10 Sarah Nduta — missed pre-sale follow-up
('f1000000-0000-0000-0000-000000000004',
  '01000000-0000-0000-0000-000000000010', NULL, '22222222-2222-2222-2222-222222222222',
  'pre_sale', CURRENT_DATE - 12,
  'Follow up on dashcam quote. Sarah was reviewing.',
  'missed', NULL),

-- lead_11 Michael Kamau — completed pre-sale (bulk discount)
('f1000000-0000-0000-0000-000000000005',
  '01000000-0000-0000-0000-000000000011', NULL, '22222222-2222-2222-2222-222222222222',
  'pre_sale', CURRENT_DATE - 7,
  'Manager approved 15% bulk discount for 5 units. Call Michael to close.',
  'completed', now() - INTERVAL '7 days'),

-- lead_16 Esther Kamau — pending (payday follow-up)
('f1000000-0000-0000-0000-000000000006',
  '01000000-0000-0000-0000-000000000016', NULL, '33333333-3333-3333-3333-333333333333',
  'pre_sale', CURRENT_DATE + 6,
  'Esther gets paid Friday. Call to confirm Anti-Jammer order.',
  'pending', NULL);
